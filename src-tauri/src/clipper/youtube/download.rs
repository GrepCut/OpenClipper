//! Port of yt-dlp `downloader/http.py` for one file: ranged chunks, resume after
//! errors and `Content-Range` validation.

use super::{
    cancellable, check_cancel,
    clients::{send, status_error, SendError, Session},
    disk_error, network_error, ImportError,
};
use reqwest::{header, Response, StatusCode, Url};
use std::{io::SeekFrom, path::Path, sync::atomic::AtomicBool};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

/// `http_chunk_size` of YouTube formats. Unranged requests are throttled.
const CHUNK_SIZE: u64 = 10 << 20;
/// yt-dlp `--retries`.
const RETRIES: u32 = 10;

/// `bytes start-end/total`
fn content_range(response: &Response) -> Option<(u64, u64, u64)> {
    let value = response
        .headers()
        .get(header::CONTENT_RANGE)?
        .to_str()
        .ok()?;
    let (range, total) = value.trim().strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.parse().ok()?))
}

async fn truncate(file: &mut tokio::fs::File, length: u64) -> Result<(), ImportError> {
    file.flush().await.map_err(disk_error)?;
    file.set_len(length).await.map_err(disk_error)?;
    file.seek(SeekFrom::Start(length)).await.map_err(disk_error)?;
    Ok(())
}

/// Downloads `url` to `path`. `on_progress` receives the bytes saved so far and
/// the file size, once the server has told it.
pub(super) async fn download(
    session: &Session,
    url: &Url,
    path: &Path,
    origin: fn(&Url) -> bool,
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), ImportError> {
    let network = network_error("download");
    let mut file = tokio::fs::File::create(path).await.map_err(disk_error)?;
    let received = async {
        let mut written = 0u64;
        let mut total: Option<u64> = None;
        let mut failures = 0;
        loop {
            check_cancel(cancelled)?;
            if failures > RETRIES {
                return Err(network);
            }
            // yt-dlp varies the chunk between 95% and 100% of the maximum.
            let jitter = (uuid::Uuid::new_v4().as_u128() % u128::from(CHUNK_SIZE / 20)) as u64;
            let mut end = written.saturating_add(CHUNK_SIZE - jitter - 1);
            if let Some(total) = total {
                end = end.min(total - 1);
            }
            let range = format!("bytes={written}-{end}");
            let response = send(
                url.clone(),
                origin,
                |url| {
                    session
                        .http
                        .get(url)
                        .header(header::ACCEPT_ENCODING, "identity")
                        .header(header::RANGE, &range)
                },
                cancelled,
            )
            .await;
            let mut response = match response {
                Ok(response) => response,
                Err(SendError::Cancelled(cancel)) => return Err(cancel),
                Err(SendError::Transport) => {
                    failures += 1;
                    continue;
                }
            };
            let status = response.status();
            if status == StatusCode::RANGE_NOT_SATISFIABLE && written > 0 {
                // The server disagrees about the size: start over.
                truncate(&mut file, 0).await?;
                (written, total) = (0, None);
                failures += 1;
                continue;
            }
            if status.is_server_error() {
                failures += 1;
                continue;
            }
            if !status.is_success() {
                return Err(status_error(status, "download"));
            }
            let expected = match status {
                StatusCode::PARTIAL_CONTENT => {
                    let range = content_range(&response).filter(|&(start, last, size)| {
                        start == written && last >= start && last <= end && last < size
                            && total.is_none_or(|previous| previous == size)
                    });
                    let Some((start, last, size)) = range else {
                        failures += 1;
                        continue;
                    };
                    let length = last - start + 1;
                    if response.content_length().is_some_and(|body| body != length) {
                        failures += 1;
                        continue;
                    }
                    total = Some(size);
                    Some(length)
                }
                StatusCode::OK => {
                    // The range was ignored: start again with the whole response.
                    if written > 0 {
                        truncate(&mut file, 0).await?;
                        written = 0;
                    }
                    total = response.content_length();
                    total
                }
                _ => {
                    failures += 1;
                    continue;
                }
            };
            let start = written;
            let mut overlong = false;
            let complete = loop {
                match cancellable(response.chunk(), cancelled).await? {
                    Ok(Some(chunk)) => {
                        if expected.is_some_and(|limit| chunk.len() as u64 > limit - (written - start)) {
                            overlong = true;
                            break false;
                        }
                        file.write_all(&chunk).await.map_err(disk_error)?;
                        written += chunk.len() as u64;
                        on_progress(written, total);
                    }
                    Ok(None) => break true,
                    Err(_) => break false,
                }
            };
            let size = written - start;
            if overlong || (complete && expected.is_some_and(|limit| limit != size)) {
                truncate(&mut file, start).await?;
                written = start;
                failures += 1;
                if status == StatusCode::OK { total = None; }
                continue;
            }
            if !complete || size == 0 {
                // Resume from what is already on disk.
                failures += 1;
                if total.is_none() || total.is_some_and(|limit| written >= limit) {
                    truncate(&mut file, start).await?;
                    written = start;
                    if status == StatusCode::OK { total = None; }
                }
                continue;
            }
            match total {
                Some(total) if written < total => continue,
                Some(total) if written > total => return Err(network),
                _ => return Ok(()),
            }
        }
    }
    .await;
    // Finish pending Windows file IO before the job removes its temporary directory.
    let flushed = file.flush().await.map_err(disk_error);
    received.and(flushed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::HeaderMap, response::IntoResponse, routing::get, Router};
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn streams_a_media_fixture_and_rejects_a_missing_one() {
        const BYTES: &[u8] = b"synthetic stream";
        const SPLIT: usize = 8;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let offsets = Arc::new(Mutex::new(Vec::new()));
        let requests = offsets.clone();
        let server = tokio::spawn(async {
            let ranged = move |headers: HeaderMap| {
                let requests = requests.clone();
                async move {
                    let start = headers[header::RANGE].to_str().unwrap()
                        .strip_prefix("bytes=").unwrap().split_once('-').unwrap().0
                        .parse::<usize>().unwrap();
                    let attempt = {
                        let mut offsets = requests.lock().unwrap();
                        offsets.push(start);
                        offsets.len()
                    };
                    let (last, bytes) = match attempt {
                        1 => (SPLIT - 1, &BYTES[..SPLIT]),
                        // This body exceeds the range advertised in the header.
                        2 => (BYTES.len() - 2, &BYTES[SPLIT..]),
                        _ => (BYTES.len() - 1, &BYTES[start..]),
                    };
                    let range = format!("bytes {start}-{last}/{}", BYTES.len());
                    (StatusCode::PARTIAL_CONTENT, [(header::CONTENT_RANGE, range)], Body::from(bytes)).into_response()
                }
            };
            let router = Router::new().route("/", get(|| async { BYTES })).route("/ranged", get(ranged));
            axum::serve(listener, router).await.unwrap();
        });
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("video.mp4");
        let cancelled = AtomicBool::new(false);
        let session = Session::new().unwrap();
        let url = Url::parse(&url).unwrap();
        download(&session, &url, &file, |_| true, &cancelled, |_, _| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), BYTES);
        download(&session, &url.join("ranged").unwrap(), &file, |_| true, &cancelled, |_, _| {})
            .await.unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), BYTES);
        assert_eq!(*offsets.lock().unwrap(), [0, SPLIT, SPLIT]);
        let missing = url.join("missing").unwrap();
        let error = download(&session, &missing, &file, |_| true, &cancelled, |_, _| {})
            .await
            .unwrap_err();
        assert_eq!(error.code, "youtube_http_denied");
        server.abort();
    }
}
