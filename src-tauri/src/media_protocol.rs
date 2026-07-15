use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    collections::HashMap,
    fs::File,
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::http::{header, Method, Request, Response, StatusCode};

const MEDIA_PROTOCOL: &str = "grepcut-media";

// Cap pojedynczego body z protokołu media. Wbudowane WebView2/WebKit i tak
// pobiera duże pliki kolejnymi Range requestami, więc nie ma sensu trzymać
// w pamięci więcej niż jeden chunk naraz — to zapobiega OOM/crashowi procesu
// Tauri przy importowaniu wielogigabajtowych wideo.
const MAX_RANGE_CHUNK: u64 = 8 * 1024 * 1024;

static MEDIA_REGISTRY: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, PathBuf>> {
    MEDIA_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredMediaSource {
    url: String,
}

fn register_canonical(path: &Path) -> Result<RegisteredMediaSource, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Cannot resolve media path '{}': {}", path.display(), error))?;

    if !canonical.is_file() {
        return Err(format!("Media path is not a file: {}", canonical.display()));
    }

    let token = make_token(&canonical)?;
    registry()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(token.clone(), canonical);

    Ok(RegisteredMediaSource {
        url: media_url(&token),
    })
}

#[tauri::command]
pub fn register_media_source(path: String) -> Result<RegisteredMediaSource, String> {
    register_canonical(Path::new(&path))
}

/// Rejestruje katalog pod jednym tokenem — pliki wewnątrz są serwowane jako
/// `<base_url>/<nazwa_pliku>` (patrz `resolve_request_path`). Zwraca
/// `(token, base_url)`; token służy później do `unregister_media_token`.
pub(crate) fn register_media_dir(path: &Path) -> Result<(String, String), String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Cannot resolve media dir '{}': {}", path.display(), error))?;

    if !canonical.is_dir() {
        return Err(format!(
            "Media path is not a directory: {}",
            canonical.display()
        ));
    }

    let token = make_token(&canonical)?;
    registry()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(token.clone(), canonical);

    Ok((token.clone(), media_url(&token)))
}

pub(crate) fn unregister_media_token(token: &str) {
    if let Ok(mut map) = registry().lock() {
        map.remove(token);
    }
}

pub fn media_protocol_handler(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return response_builder(StatusCode::NO_CONTENT, "application/octet-stream", 0)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, Content-Type")
            .body(Vec::new())
            .unwrap_or_else(error_response);
    }

    if request.method() != Method::GET && request.method() != Method::HEAD {
        return response_builder(StatusCode::METHOD_NOT_ALLOWED, "text/plain", 0)
            .body(b"method not allowed".to_vec())
            .unwrap_or_else(error_response);
    }

    match resolve_request_path(&request) {
        Ok(path) => serve_file(request, path),
        Err(message) => response_builder(StatusCode::NOT_FOUND, "text/plain", message.len() as u64)
            .body(message.into_bytes())
            .unwrap_or_else(error_response),
    }
}

fn resolve_request_path(request: &Request<Vec<u8>>) -> Result<PathBuf, String> {
    let mut segments = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .filter(|value| !value.is_empty());

    let token = segments
        .next()
        .ok_or_else(|| "missing media token".to_string())?;

    let base = registry()
        .lock()
        .map_err(|error| error.to_string())?
        .get(token)
        .cloned()
        .ok_or_else(|| "unknown media token".to_string())?;

    // Token plikowy: dodatkowe segmenty ignorujemy (dotychczasowe zachowanie).
    if base.is_file() {
        return Ok(base);
    }

    // Token katalogowy: dołącz sanityzowane segmenty ścieżki wewnątrz katalogu.
    let mut path = base;
    let mut joined = false;
    for segment in segments {
        if !is_safe_path_segment(segment) {
            return Err("invalid media path segment".to_string());
        }
        path.push(segment);
        joined = true;
    }
    if !joined {
        return Err("missing file path for directory token".to_string());
    }
    Ok(path)
}

pub(crate) fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

pub(crate) fn serve_file(request: Request<Vec<u8>>, path: PathBuf) -> Response<Vec<u8>> {
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return response_builder(StatusCode::NOT_FOUND, "text/plain", 0)
                .body(format!("media file not found: {}", error).into_bytes())
                .unwrap_or_else(error_response);
        }
    };

    let file_len = metadata.len();
    let mime = mime_for_path(&path);
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());

    let range = match range_header {
        Some(value) => match parse_range(value, file_len) {
            Ok(range) => Some(range),
            Err(_) => {
                return response_builder(StatusCode::RANGE_NOT_SATISFIABLE, "text/plain", 0)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", file_len))
                    .body(Vec::new())
                    .unwrap_or_else(error_response);
            }
        },
        None => None,
    };

    let (start, end, status) = match range {
        Some((start, end)) => {
            // Ograniczamy zakres do MAX_RANGE_CHUNK aby nigdy nie alokować
            // jednorazowo więcej niż chunk. Klient dokończy pobieranie kolejnymi
            // Range requestami (Content-Range mówi mu ile faktycznie dostał).
            let capped_end = end.min(start.saturating_add(MAX_RANGE_CHUNK - 1));
            (start, capped_end, StatusCode::PARTIAL_CONTENT)
        }
        None => {
            if file_len == 0 {
                (0, 0, StatusCode::OK)
            } else if file_len <= MAX_RANGE_CHUNK {
                (0, file_len - 1, StatusCode::OK)
            } else {
                // Duży plik bez nagłówka Range — odpowiadamy 206 z pierwszym
                // chunkiem. WebView/<video> zacznie odtąd chodzić Range'ami,
                // zamiast oczekiwać całego pliku w jednej odpowiedzi.
                (0, MAX_RANGE_CHUNK - 1, StatusCode::PARTIAL_CONTENT)
            }
        }
    };

    let body_len = if file_len == 0 { 0 } else { end - start + 1 };
    let mut builder = response_builder(status, mime, body_len);
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, end, file_len),
        );
    }

    if request.method() == Method::HEAD || body_len == 0 {
        return builder.body(Vec::new()).unwrap_or_else(error_response);
    }

    let body = match read_file_range(&path, start, body_len) {
        Ok(body) => body,
        Err(error) => {
            return response_builder(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", 0)
                .body(format!("failed to read media: {}", error).into_bytes())
                .unwrap_or_else(error_response);
        }
    };

    builder.body(body).unwrap_or_else(error_response)
}

fn response_builder(
    status: StatusCode,
    content_type: &str,
    content_length: u64,
) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, content_length.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Length, Content-Range",
        )
}

fn error_response(_: tauri::http::Error) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .body(Vec::new())
        .expect("static response should be valid")
}

fn read_file_range(path: &Path, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buffer = vec![0; len as usize];
    file.read_exact(&mut buffer)?;
    Ok(buffer)
}

fn parse_range(value: &str, file_len: u64) -> Result<(u64, u64), ()> {
    if file_len == 0 {
        return Err(());
    }

    let spec = value.strip_prefix("bytes=").ok_or(())?;
    let first_range = spec.split(',').next().ok_or(())?.trim();
    let (start_raw, end_raw) = first_range.split_once('-').ok_or(())?;

    if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().map_err(|_| ())?;
        if suffix_len == 0 {
            return Err(());
        }
        let start = file_len.saturating_sub(suffix_len);
        return Ok((start, file_len - 1));
    }

    let start = start_raw.parse::<u64>().map_err(|_| ())?;
    if start >= file_len {
        return Err(());
    }

    let end = if end_raw.is_empty() {
        file_len - 1
    } else {
        end_raw.parse::<u64>().map_err(|_| ())?.min(file_len - 1)
    };

    if end < start {
        return Err(());
    }

    Ok((start, end))
}

fn make_token(path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn media_url(token: &str) -> String {
    // Windows WebView2 serves custom protocols as http(s)://<scheme>.localhost/.
    // Keep `https` in sync with `useHttpsScheme: true` on the main window in tauri.conf.json.
    if cfg!(windows) {
        format!("https://{}.localhost/{}", MEDIA_PROTOCOL, token)
    } else {
        format!("{}://localhost/{}", MEDIA_PROTOCOL, token)
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        // Assety modeli ML serwowane przez grepcut-models: poprawny MIME jest
        // wymagany do streaming-compile WASM i dynamic import() glue JS.
        "wasm" => "application/wasm",
        "js" | "mjs" => "text/javascript",
        "json" => "application/json",
        "onnx" | "tflite" | "task" | "bin" | "data" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}
