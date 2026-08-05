use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService,
    session::local::LocalSessionManager,
};
use sea_orm::DatabaseConnection;
use tauri::AppHandle;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

use crate::clipper::data::{clipper_project_data_dir, validate_export_file_name};
use crate::clipper::exports_notify::{ClipperExportsChangedEvent, enqueue_exports_changed};
use crate::mcp::server::OpenClipperMcpServer;

pub const DEFAULT_MCP_HTTP_PORT: u16 = 12742;

const MCP_SESSION_KEEP_ALIVE_SECS: u64 = 3600;

const STUDIO_IMPORT_JSON: &str = "clipper-studio-import.json";
const STUDIO_IMPORT_VIDEO: &str = "clip-trimmed.mp4";
const STUDIO_IMPORT_THUMBS_INDEX: &str = "clip-thumbnails.json";
const STUDIO_IMPORT_THUMBS_PACK: &str = "clip-thumbnails.ndjson";

fn is_studio_thumb_jpeg(file_name: &str) -> bool {
    let Some(rest) = file_name.strip_prefix("thumb-") else {
        return false;
    };
    let Some(digits) = rest.strip_suffix(".jpg") else {
        return false;
    };
    digits.len() == 4 && digits.chars().all(|c| c.is_ascii_digit())
}

const ALLOWED_STUDIO_ORIGINS_EXACT: &[&str] = &["https://studio.grepcut.com"];

const DEFAULT_CORS_ALLOW_HEADERS: &str = "Content-Type, Range";

#[derive(Clone)]
pub struct McpHttpServer {
    pub base_url: String,
    pub port: u16,
    cancel: CancellationToken,
}

impl McpHttpServer {
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

#[derive(Clone)]
struct StudioImportState {
    app: AppHandle,
}

fn allowed_hosts_for_port(port: u16) -> Vec<String> {
    vec![
        "127.0.0.1".to_string(),
        format!("127.0.0.1:{port}"),
        "localhost".to_string(),
        format!("localhost:{port}"),
        "::1".to_string(),
    ]
}

fn origin_allowed(origin: &str) -> bool {
    if ALLOWED_STUDIO_ORIGINS_EXACT
        .iter()
        .any(|allowed| *allowed == origin)
    {
        return true;
    }
    is_local_studio_origin(origin)
}

fn is_local_studio_origin(origin: &str) -> bool {
    let rest = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"));
    let Some(rest) = rest else {
        return false;
    };

    let host = match rest.split_once('/') {
        Some((host, path)) if path.is_empty() => host,
        None => rest,
        Some(_) => return false,
    };

    let (hostname, port) = if let Some(hostname) = host.strip_prefix("[::1]") {
        if hostname.is_empty() {
            (true, None)
        } else if let Some(port) = hostname.strip_prefix(':') {
            (true, Some(port))
        } else {
            return false;
        }
    } else if let Some((name, port)) = host.split_once(':') {
        (name == "localhost" || name == "127.0.0.1", Some(port))
    } else {
        (host == "localhost" || host == "127.0.0.1", None)
    };

    if !hostname {
        return false;
    }
    match port {
        None => true,
        Some(port) => !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()),
    }
}

fn cors_allow_headers(request_headers: &HeaderMap) -> HeaderValue {
    request_headers
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| HeaderValue::from_str(value).ok())
        .unwrap_or_else(|| HeaderValue::from_static(DEFAULT_CORS_ALLOW_HEADERS))
}

fn cors_headers_for_request(request_headers: &HeaderMap) -> HeaderMap {
    let origin = request_origin(request_headers);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::VARY,
        HeaderValue::from_static("Origin, Access-Control-Request-Headers"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, OPTIONS"),
    );
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, cors_allow_headers(request_headers));
    headers.insert(
        HeaderName::from_static("access-control-allow-private-network"),
        HeaderValue::from_static("true"),
    );
    if let Some(origin) = origin.filter(|o| origin_allowed(o)) {
        if let Ok(value) = HeaderValue::from_str(origin) {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        }
    }
    headers
}

fn apply_cors(mut response: Response, request_headers: &HeaderMap) -> Response {
    let cors = cors_headers_for_request(request_headers);
    let headers = response.headers_mut();
    for (key, value) in cors.iter() {
        headers.insert(key, value.clone());
    }
    response
}

fn request_origin(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
}

fn is_safe_project_id(project_id: &str) -> bool {
    !project_id.is_empty()
        && project_id.len() <= 128
        && project_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_whitelisted_studio_import_file(file_name: &str) -> bool {
    file_name == STUDIO_IMPORT_JSON
        || file_name == STUDIO_IMPORT_VIDEO
        || file_name == STUDIO_IMPORT_THUMBS_INDEX
        || file_name == STUDIO_IMPORT_THUMBS_PACK
        || is_studio_thumb_jpeg(file_name)
}

fn content_type_for_file(file_name: &str) -> &'static str {
    if file_name.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if file_name.ends_with(".ndjson") {
        "application/x-ndjson; charset=utf-8"
    } else if file_name.ends_with(".mp4") {
        "video/mp4"
    } else if file_name.ends_with(".jpg") || file_name.ends_with(".jpeg") {
        "image/jpeg"
    } else {
        "application/octet-stream"
    }
}

async fn handle_exports_changed(Json(detail): Json<ClipperExportsChangedEvent>) -> StatusCode {
    enqueue_exports_changed(detail);
    StatusCode::NO_CONTENT
}

async fn handle_studio_import_health(headers: HeaderMap) -> Response {
    apply_cors((StatusCode::OK, "ok").into_response(), &headers)
}

async fn handle_studio_import_health_options(headers: HeaderMap) -> Response {
    apply_cors(StatusCode::NO_CONTENT.into_response(), &headers)
}

async fn handle_studio_import_options(
    Path((_project_id, _file)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    apply_cors(StatusCode::NO_CONTENT.into_response(), &headers)
}

async fn handle_studio_import_file(
    State(state): State<StudioImportState>,
    Path((project_id, file_name)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let respond = |response: Response| apply_cors(response, &headers);

    if !is_safe_project_id(&project_id) {
        return respond((StatusCode::BAD_REQUEST, "invalid project id").into_response());
    }
    if validate_export_file_name(&file_name).is_err()
        || !is_whitelisted_studio_import_file(&file_name)
    {
        return respond((StatusCode::NOT_FOUND, "file not found").into_response());
    }

    let path: PathBuf = match clipper_project_data_dir(&state.app, &project_id) {
        Ok(dir) => dir.join(&file_name),
        Err(_) => {
            return respond((StatusCode::NOT_FOUND, "project data not found").into_response());
        }
    };

    if !path.is_file() {
        return respond((StatusCode::NOT_FOUND, "file not found").into_response());
    }

    let file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => {
            return respond((StatusCode::NOT_FOUND, "file not found").into_response());
        }
    };

    let len = match file.metadata().await {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);
    let mut response = Response::new(body);
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for_file(&file_name)),
    );
    if len > 0 {
        if let Ok(value) = HeaderValue::from_str(&len.to_string()) {
            response.headers_mut().insert(header::CONTENT_LENGTH, value);
        }
    }
    respond(response)
}

pub async fn start_mcp_http_server(
    app: AppHandle,
    database: Arc<DatabaseConnection>,
    port: u16,
) -> Result<McpHttpServer, String> {
    let app_for_mcp = app.clone();
    let app_for_studio = app.clone();
    crate::clipper::exports_notify::spawn_exports_notify_listener(app);

    let cancel = CancellationToken::new();
    let config = StreamableHttpServerConfig::default()
        .with_cancellation_token(cancel.clone())
        .with_json_response(true)
        .with_allowed_hosts(allowed_hosts_for_port(port));

    let mut session_manager = LocalSessionManager::default();
    session_manager.session_config.keep_alive =
        Some(Duration::from_secs(MCP_SESSION_KEEP_ALIVE_SECS));

    let service: StreamableHttpService<OpenClipperMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(OpenClipperMcpServer::with_app(database.clone(), app_for_mcp.clone())),
            Arc::new(session_manager),
            config,
        );

    let studio_state = StudioImportState {
        app: app_for_studio,
    };

    let studio_router = Router::new()
        .route(
            "/studio-import/health",
            get(handle_studio_import_health).options(handle_studio_import_health_options),
        )
        .route(
            "/studio-import/{project_id}/{file}",
            get(handle_studio_import_file).options(handle_studio_import_options),
        )
        .with_state(studio_state);

    let router = Router::new()
        .route(
            "/mcp/internal/exports-changed",
            post(handle_exports_changed),
        )
        .merge(studio_router)
        .nest_service("/mcp", service);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|error| format!("MCP HTTP bind failed on {addr}: {error}"))?;

    let base_url = format!("http://{addr}/mcp");
    let shutdown = cancel.clone();

    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown.cancelled_owned().await;
            })
            .await
        {
            log::error!("Open Clipper MCP HTTP server stopped: {error}");
        }
    });

    log::info!("Open Clipper MCP HTTP listening on {base_url}");
    log::info!("Open Clipper studio-import on http://{addr}/studio-import/");

    Ok(McpHttpServer {
        base_url,
        port,
        cancel,
    })
}

pub fn resolve_mcp_http_port() -> u16 {
    std::env::var("OPEN_CLIPPER_MCP_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_MCP_HTTP_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_exact_prod_studio_origin() {
        assert!(origin_allowed("https://studio.grepcut.com"));
    }

    #[test]
    fn allows_local_studio_origins_any_port() {
        for origin in [
            "https://localhost:5173",
            "http://localhost:5173",
            "https://127.0.0.1:5173",
            "http://127.0.0.1:5173",
            "https://localhost:5174",
            "http://[::1]:5173",
            "https://[::1]",
            "http://localhost",
        ] {
            assert!(origin_allowed(origin), "expected allow {origin}");
        }
    }

    #[test]
    fn rejects_non_studio_origins() {
        for origin in [
            "https://evil.example",
            "https://studio.grepcut.com.evil",
            "https://localhost.attacker.com",
            "ftp://localhost:5173",
            "https://192.168.1.1:5173",
            "https://localhost:5173/extra",
        ] {
            assert!(!origin_allowed(origin), "expected reject {origin}");
        }
    }
}
