//! Shared blocking HTTP download helpers for model assets.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadEvent {
    pub path: String,
    pub received: u64,
    pub total: Option<u64>,
    pub done: bool,
    pub error: Option<String>,
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|error| format!("Cannot read file: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot hash file: {error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub fn download_url_to_file(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    event_path: &str,
    expected_size: Option<u64>,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create download dir: {error}"))?;
    }

    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("Download failed ({url}): {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed ({url}): HTTP {}",
            response.status()
        ));
    }

    let total = expected_size.or_else(|| response.content_length());
    let part_path = dest.with_extension(format!(
        "{}.part",
        dest.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
    ));
    let mut file = std::fs::File::create(&part_path)
        .map_err(|error| format!("Cannot create download file: {error}"))?;
    let mut received = 0_u64;
    let mut last_emit = 0_u64;
    let mut buffer = [0u8; 64 * 1024];
    let mut digest = Sha256::new();
    let emit = |received: u64, done: bool, error: Option<String>| {
        let _ = app.emit(
            "model-download",
            ModelDownloadEvent {
                path: event_path.to_string(),
                received,
                total,
                done,
                error,
            },
        );
    };
    emit(0, false, None);

    loop {
        let read = match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) => {
                let _ = std::fs::remove_file(&part_path);
                let message = format!("Download interrupted ({url}): {error}");
                emit(received, true, Some(message.clone()));
                return Err(message);
            }
        };
        if let Err(error) = file.write_all(&buffer[..read]) {
            let _ = std::fs::remove_file(&part_path);
            let message = format!("Download write failed: {error}");
            emit(received, true, Some(message.clone()));
            return Err(message);
        }
        received += read as u64;
        digest.update(&buffer[..read]);
        if received - last_emit >= 512 * 1024 {
            last_emit = received;
            emit(received, false, None);
        }
    }
    drop(file);

    if let Some(expected) = expected_size {
        if received != expected {
            let _ = std::fs::remove_file(&part_path);
            let message = format!(
                "Download incomplete ({url}): {received}/{expected} bytes"
            );
            emit(received, true, Some(message.clone()));
            return Err(message);
        }
    }
    if let Some(expected) = expected_sha256 {
        if !format!("{:x}", digest.finalize()).eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(&part_path);
            let message = format!("Download checksum mismatch ({url})");
            emit(received, true, Some(message.clone()));
            return Err(message);
        }
    }

    std::fs::rename(&part_path, dest).map_err(|error| {
        let _ = std::fs::remove_file(&part_path);
        format!("Download rename failed: {error}")
    })?;
    emit(received, true, None);
    Ok(())
}
