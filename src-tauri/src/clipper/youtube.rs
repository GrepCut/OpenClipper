//! Single-video YouTube import, a port of yt-dlp's YouTube extractor. See
//! `docs/youtube-import.md` for the file by file mapping.

use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use std::{
    future::Future,
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncWriteExt;

mod clients;
mod download;
mod extract;
mod formats;
mod mux;
mod player;

pub(crate) const VERSION: &str = "da452a569/ejs-0.8.0/2";

#[derive(Clone, Copy, Debug, Serialize)]
pub(crate) struct ImportError {
    pub code: &'static str,
    pub phase: &'static str,
    pub message: &'static str,
}

impl ImportError {
    pub(crate) const fn new(
        code: &'static str,
        phase: &'static str,
        message: &'static str,
    ) -> Self {
        Self {
            code,
            phase,
            message,
        }
    }
}

const INVALID: ImportError = ImportError::new(
    "invalid_link",
    "validation",
    "Enter a link to one YouTube video or Short.",
);
const UNAVAILABLE: ImportError = ImportError::new(
    "video_unavailable",
    "resolve",
    "This video is unavailable for import. You can choose a video file instead.",
);
const NO_FORMAT: ImportError = ImportError::new(
    "no_compatible_format",
    "resolve",
    "YouTube did not provide a compatible MP4. You can choose a video file instead.",
);
const PLAYER_RESPONSE: ImportError = ImportError::new(
    "player_response_changed",
    "resolve",
    "Open Clipper could not read the YouTube player response. Try again or choose a video file.",
);
const LIVE: ImportError = ImportError::new(
    "live_video",
    "resolve",
    "Live and upcoming YouTube streams cannot be imported.",
);
const SIGN_IN: ImportError = ImportError::new(
    "sign_in_required",
    "resolve",
    "This YouTube video requires sign-in or age verification.",
);
const BOT_CHECK: ImportError = ImportError::new(
    "bot_check",
    "resolve",
    "YouTube asked to confirm you are not a bot. Try again later or choose a video file.",
);
const CANCELLED: ImportError = ImportError::new("cancelled", "cancel", "Import cancelled.");

fn network_error(phase: &'static str) -> ImportError {
    ImportError::new(
        "network",
        phase,
        "Could not connect to YouTube. Check your connection and try again.",
    )
}

fn disk_error(error: io::Error) -> ImportError {
    match error.kind() {
        io::ErrorKind::StorageFull => ImportError::new(
            "disk_full",
            "save",
            "There is not enough space to save this video.",
        ),
        _ => ImportError::new(
            "disk_write",
            "save",
            "Could not save the video to disk.",
        ),
    }
}

pub(crate) fn check_cancel(cancelled: &AtomicBool) -> Result<(), ImportError> {
    if cancelled.load(Ordering::Acquire) {
        Err(CANCELLED)
    } else {
        Ok(())
    }
}

async fn cancellable<F: Future>(
    operation: F,
    cancelled: &AtomicBool,
) -> Result<F::Output, ImportError> {
    check_cancel(cancelled)?;
    tokio::select! {
        result = operation => Ok(result),
        _ = async {
            while !cancelled.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        } => Err(CANCELLED),
    }
}

pub(crate) fn video_id(input: &str) -> Result<String, ImportError> {
    let url = Url::parse(input.trim()).map_err(|_| INVALID)?;
    if !matches!(url.scheme(), "https" | "http")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(INVALID);
    }
    let path = url.path();
    let id = match url.host_str() {
        Some("youtu.be" | "www.youtu.be") => Some(path.trim_start_matches('/').to_owned()),
        Some("youtube.com" | "www.youtube.com" | "m.youtube.com") if path == "/watch" => url
            .query_pairs()
            .find(|(name, _)| name == "v")
            .map(|(_, value)| value.into_owned()),
        Some("youtube.com" | "www.youtube.com" | "m.youtube.com") => {
            path.strip_prefix("/shorts/").map(str::to_owned)
        }
        _ => None,
    }
    .ok_or(INVALID)?;
    if id.len() != 11
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(INVALID);
    }
    Ok(id)
}

fn unix_now() -> Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

#[derive(Clone, Copy, Serialize)]
pub(crate) struct Progress {
    pub phase: &'static str,
    pub ratio: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedVideo {
    pub(crate) file_path: String,
    pub(crate) file_name: String,
}

struct ImportFiles(PathBuf);

impl Drop for ImportFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// `title [id]`, like yt-dlp's default file name, safe on Windows.
fn file_stem(title: Option<&str>, id: &str) -> String {
    let cleaned: String = title
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = words.chars().take(120).collect();
    let name = short.trim_matches([' ', '.']);
    let name = if name.is_empty() {
        "YouTube video"
    } else {
        name
    };
    format!("{name} [{id}]")
}

/// Publishes only a complete file, without replacing an existing download.
async fn save(
    source: &Path,
    destination: &Path,
    stem: &str,
    cancelled: &AtomicBool,
) -> Result<PathBuf, ImportError> {
    let mut copied: Option<tempfile::NamedTempFile> = None;
    for suffix in 0..=u64::MAX {
        check_cancel(cancelled)?;
        let name = match suffix {
            0 => format!("{stem}.mp4"),
            _ => format!("{stem} ({suffix}).mp4"),
        };
        let target = destination.join(name);
        let temporary = if let Some(temporary) = copied.take() {
            temporary
        } else {
            // On the same volume a hard link publishes the existing file atomically.
            match tokio::fs::hard_link(source, &target).await {
                Ok(()) => return Ok(target),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(_) => {}
            }
            let temporary = tempfile::Builder::new()
                .prefix(".open-clipper-")
                .suffix(".part")
                .tempfile_in(destination)
                .map_err(disk_error)?;
            let mut input = tokio::fs::File::open(source).await.map_err(disk_error)?;
            let mut output = tokio::fs::File::from_std(temporary.reopen().map_err(disk_error)?);
            let result = cancellable(tokio::io::copy(&mut input, &mut output), cancelled).await;
            let flushed = output.flush().await;
            result?.map_err(disk_error)?;
            flushed.map_err(disk_error)?;
            output.sync_all().await.map_err(disk_error)?;
            temporary
        };
        check_cancel(cancelled)?;
        match temporary.persist_noclobber(&target) {
            Ok(_) => return Ok(target),
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                copied = Some(error.file);
            }
            Err(error) => return Err(disk_error(error.error)),
        }
    }
    Err(ImportError::new("download_name", "save", "Could not choose a name for the downloaded video."))
}

/// Why there is nothing to download, from the playability of the responses.
fn unusable(responses: &[extract::PlayerResponse]) -> ImportError {
    if responses.iter().any(|response| {
        response.client.is_some() && extract::playability(&response.data) == Some("OK")
    }) {
        return NO_FORMAT;
    }
    if responses.iter().any(|response| {
        response
            .data
            .pointer("/playabilityStatus/reason")
            .and_then(Value::as_str)
            .is_some_and(|reason| reason.contains("not a bot"))
    }) {
        return BOT_CHECK;
    }
    if responses.iter().any(|response| {
        extract::is_agegated(&response.data)
            || matches!(
                extract::playability(&response.data),
                Some("LOGIN_REQUIRED" | "AGE_CHECK_REQUIRED" | "AGE_VERIFICATION_REQUIRED")
            )
    }) {
        return SIGN_IN;
    }
    UNAVAILABLE
}

/// Finds the streams to download for one video, and its title.
async fn resolve(
    session: &clients::Session,
    id: &str,
    cancelled: &AtomicBool,
) -> Result<(formats::Selection, Option<String>), ImportError> {
    let mut player = player::Player::default();
    let extraction = extract::extract(session, &mut player, id, cancelled).await?;
    let responses = &extraction.responses;
    let flag = |pointer: &str| {
        responses
            .iter()
            .any(|response| response.data.pointer(pointer).and_then(Value::as_bool) == Some(true))
    };
    if flag("/videoDetails/isLive")
        || flag("/videoDetails/isUpcoming")
        || responses
            .iter()
            .any(|response| extract::playability(&response.data) == Some("LIVE_STREAM_OFFLINE"))
    {
        return Err(LIVE);
    }
    let duration = responses.iter().find_map(|response| {
        response
            .data
            .pointer("/videoDetails/lengthSeconds")?
            .as_str()?
            .parse()
            .ok()
    });
    let challenges = formats::challenges(responses);
    let solutions = match &extraction.player_url {
        Some(url) => player.solve(session, url, &challenges, cancelled).await?,
        None => player::Solutions::default(),
    };
    let found = formats::process(
        responses,
        &solutions,
        extraction.player_url.is_some(),
        duration,
    );
    let title = responses.iter().find_map(|response| {
        response
            .data
            .pointer("/videoDetails/title")?
            .as_str()
            .map(str::to_owned)
    });
    let selection = formats::select(found).ok_or_else(|| {
        let answered = responses.iter().any(|response| response.client.is_some());
        match extraction.error {
            Some(error) if !answered => error,
            None if responses.is_empty() => PLAYER_RESPONSE,
            _ => unusable(responses),
        }
    })?;
    Ok((selection, title))
}

/// Downloads one video into `destination`. Partial files stay in `work`.
pub(crate) async fn import(
    work: &Path,
    destination: &Path,
    id: &str,
    cancelled: &AtomicBool,
    progress: impl Fn(Progress),
) -> Result<ImportedVideo, ImportError> {
    check_cancel(cancelled)?;
    let session = clients::Session::new()?;
    progress(Progress {
        phase: "resolve",
        ratio: None,
    });
    let (formats::Selection { video, audio }, title) = resolve(&session, id, cancelled).await?;

    let file_id = uuid::Uuid::new_v4();
    let temporary = work.join(format!(".import-{file_id}"));
    tokio::fs::create_dir(&temporary)
        .await
        .map_err(disk_error)?;
    let temporary = ImportFiles(temporary);
    let video_path = temporary.0.join("video.mp4");
    let audio_path = audio.as_ref().map(|_| temporary.0.join("audio.m4a"));
    let output = temporary.0.join("full.mp4");
    progress(Progress {
        phase: "download",
        ratio: None,
    });
    // YouTube may require waiting out a pre-roll ad before serving the media.
    let available_at = video
        .available_at
        .max(audio.as_ref().map_or(0, |audio| audio.available_at));
    let wait = Duration::from_secs(available_at).saturating_sub(unix_now());
    if !wait.is_zero() {
        cancellable(tokio::time::sleep(wait), cancelled).await?;
    }
    let total = match &audio {
        Some(audio) => video
            .file_size
            .zip(audio.file_size)
            .and_then(|(video, audio)| video.checked_add(audio)),
        None => video.file_size,
    };
    let mut finished_bytes = 0u64;
    let mut last_progress = Instant::now();
    let tracks =
        std::iter::once((&video, &video_path)).chain(audio.as_ref().zip(audio_path.as_ref()));
    for (format, path) in tracks {
        download::download(
            &session,
            &format.url,
            path,
            clients::media_origin,
            cancelled,
            |saved, size| {
                if last_progress.elapsed() >= Duration::from_millis(250) {
                    // With a single file the server's size will do.
                    let total = total.or(size.filter(|_| audio.is_none()));
                    progress(Progress {
                        phase: "download",
                        ratio: total.map(|total| {
                            ((finished_bytes + saved) as f64 / total as f64).clamp(0.0, 1.0)
                        }),
                    });
                    last_progress = Instant::now();
                }
            },
        )
        .await?;
        finished_bytes += tokio::fs::metadata(path).await.map_err(disk_error)?.len();
    }
    check_cancel(cancelled)?;
    progress(Progress {
        phase: "prepare",
        ratio: None,
    });
    tokio::task::block_in_place(|| {
        mux::prepare(&video_path, audio_path.as_deref(), &output, cancelled)
    })?;
    check_cancel(cancelled)?;
    let stem = file_stem(title.as_deref(), id);
    let finished = save(&output, destination, &stem, cancelled).await?;
    Ok(ImportedVideo {
        file_name: finished
            .file_name()
            .map_or_else(|| stem.clone(), |name| name.to_string_lossy().into_owned()),
        file_path: finished.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_one_video_and_discards_non_video_parameters() {
        for url in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=123",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=x",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        ] {
            assert_eq!(video_id(url).unwrap(), "dQw4w9WgXcQ");
        }
        for url in [
            "https://www.youtube.com/playlist?list=123",
            "https://youtube.com.bad.example/watch?v=dQw4w9WgXcQ",
            "https://user@youtu.be/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ/extra",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
        ] {
            assert!(video_id(url).is_err(), "{url}");
        }
    }
}
