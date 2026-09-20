use ffmpeg_next as ffmpeg;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::frames::{
    ensure_ffmpeg_init, extract_clipper_segment_to_path_blocking, snap_to_keyframe_blocking,
};

const STUDIO_CLIP_PADDING_SEC: f64 = 10.0;
const STUDIO_CLIP_PREFIX: &str = "clip-studio-";
const STUDIO_CLIP_SOURCE_FILE: &str = "clip-trimmed.mp4";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractClipperStudioClipResult {
    pub file_name: String,
    pub offset_sec: f64,
    pub duration_sec: f64,
    pub reused: bool,
}

pub(super) fn studio_source_key(source: &Path) -> Result<String, String> {
    let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    hash.update(
        source
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .as_bytes(),
    );
    hash.update(metadata.len().to_le_bytes());
    hash.update(modified.as_nanos().to_le_bytes());
    Ok(format!("{:x}", hash.finalize()))
}

fn studio_clip_file_name(source_key: &str, start_sec: f64, end_sec: f64) -> String {
    let mut hash = Sha256::new();
    hash.update(source_key.as_bytes());
    hash.update(start_sec.to_bits().to_le_bytes());
    hash.update(end_sec.to_bits().to_le_bytes());
    format!("{STUDIO_CLIP_PREFIX}v2-{:x}.mp4", hash.finalize())
}

pub(crate) fn is_studio_clip_file_name(name: &str) -> bool {
    let Some(rest) = name
        .strip_prefix(STUDIO_CLIP_PREFIX)
        .and_then(|rest| rest.strip_suffix(".mp4"))
    else {
        return false;
    };
    if let Some(key) = rest.strip_prefix("v2-") {
        return key.len() == 64 && key.bytes().all(|c| c.is_ascii_hexdigit());
    }
    let Some((start, end)) = rest.split_once('-') else {
        return false;
    };
    let is_number = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    is_number(start) && is_number(end)
}

fn padded_window(start_sec: f64, end_sec: f64, duration_secs: f64) -> (f64, f64) {
    let start = start_sec.min(end_sec).max(0.0);
    let end = start_sec.max(end_sec).max(0.0);
    let padded_start = (start - STUDIO_CLIP_PADDING_SEC).max(0.0);
    let mut padded_end = end + STUDIO_CLIP_PADDING_SEC;
    if duration_secs > 0.0 {
        padded_end = padded_end.min(duration_secs);
    }
    (padded_start, padded_end.max(padded_start))
}

fn is_newer_or_same(path: &Path, than: &Path) -> bool {
    let modified = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
    match (modified(path), modified(than)) {
        (Some(a), Some(b)) => a >= b,
        _ => false,
    }
}

pub(crate) fn extract_studio_clip_blocking(
    data_dir: &Path,
    start_sec: f64,
    end_sec: f64,
) -> Result<ExtractClipperStudioClipResult, String> {
    let source = data_dir.join(STUDIO_CLIP_SOURCE_FILE);
    if !source.is_file() {
        return Err(format!(
            "Missing {STUDIO_CLIP_SOURCE_FILE} in project data. Finish clip processing first."
        ));
    }
    let source_str = source.to_string_lossy().to_string();

    ensure_ffmpeg_init()?;
    let raw_duration = ffmpeg::format::input(&source)
        .map_err(|e| format!("Cannot open video: {e}"))?
        .duration();
    let duration_secs = if raw_duration > 0 {
        raw_duration as f64 / 1_000_000.0
    } else {
        0.0
    };

    let (window_start, window_end) = padded_window(start_sec, end_sec, duration_secs);
    let cut_start = snap_to_keyframe_blocking(source_str.clone(), window_start)?;
    let file_name = studio_clip_file_name(&studio_source_key(&source)?, cut_start, window_end);
    let output = data_dir.join(&file_name);

    let reused = output.is_file() && is_newer_or_same(&output, &source);
    if !reused {
        let partial = data_dir.join(format!("{}.{}.part.mp4", file_name, uuid::Uuid::new_v4()));
        extract_clipper_segment_to_path_blocking(source_str, cut_start, window_end, &partial)?;
        fs::rename(&partial, &output).map_err(|e| format!("Cannot finalize clip: {e}"))?;
    }

    Ok(ExtractClipperStudioClipResult {
        file_name,
        offset_sec: cut_start,
        duration_sec: (window_end - cut_start).max(0.0),
        reused,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires ffmpeg with libx264 on PATH"]
    fn studio_media_round_trip_preserves_keyframe_and_import_bundles() {
        use super::super::studio_thumbnails::extract_studio_thumbnails_blocking;
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let fixture =
            Fixture(std::env::temp_dir().join(format!("studio-test-{}", uuid::Uuid::new_v4())));
        fs::create_dir_all(&fixture.0).unwrap();
        let source = fixture.0.join(STUDIO_CLIP_SOURCE_FILE);
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=160x90:rate=60000/1001",
                "-t",
                "15",
                "-an",
                "-c:v",
                "libx264",
                "-g",
                "50",
                "-keyint_min",
                "50",
                "-sc_threshold",
                "0",
                "-bf",
                "0",
                "-video_track_timescale",
                "90000",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg must be installed for this test");
        assert!(status.success());

        let a = extract_studio_clip_blocking(&fixture.0, 12.0, 13.0).unwrap();
        assert!(!a.reused);
        assert!((a.offset_sec - 1.6683333333333334).abs() < 1e-9);
        let mut output = ffmpeg::format::input(&fixture.0.join(&a.file_name)).unwrap();
        let (_, first_packet) = output.packets().next().unwrap();
        assert!(first_packet.is_key());
        assert_eq!(
            first_packet.pts(),
            Some(0),
            "must retain the snapped keyframe, not the next GOP"
        );
        drop(output);
        let again = extract_studio_clip_blocking(&fixture.0, 12.0, 13.0).unwrap();
        assert!(again.reused);
        assert_eq!(again.file_name, a.file_name);

        let thumbs = |name: &str, force| {
            extract_studio_thumbnails_blocking(
                fixture.0.clone(),
                name.to_string(),
                force,
                None,
                "test".to_string(),
            )
            .unwrap()
        };
        let a_thumbs = thumbs(&a.file_name, false);
        let a_pack = fs::read(fixture.0.join(&a_thumbs.pack_file_name)).unwrap();
        let a_index = fs::read(fixture.0.join(&a_thumbs.index_file_name)).unwrap();
        let b = extract_studio_clip_blocking(&fixture.0, 3.0, 4.0).unwrap();
        let b_thumbs = thumbs(&b.file_name, false);
        assert_ne!(a_thumbs.pack_file_name, b_thumbs.pack_file_name);
        let cached_a = thumbs(&a.file_name, false);
        assert_eq!(
            cached_a.index_file_name, a_thumbs.index_file_name,
            "A -> B -> A must reuse A"
        );
        let forced_a = thumbs(&a.file_name, true);
        assert_ne!(forced_a.index_file_name, a_thumbs.index_file_name);
        assert_eq!(
            fs::read(fixture.0.join(&a_thumbs.pack_file_name)).unwrap(),
            a_pack
        );
        assert_eq!(
            fs::read(fixture.0.join(&a_thumbs.index_file_name)).unwrap(),
            a_index
        );
    }

    #[test]
    fn window_pads_and_clamps_to_the_file() {
        assert_eq!(padded_window(12.0, 55.0, 600.0), (2.0, 65.0));
        assert_eq!(padded_window(3.0, 40.0, 600.0), (0.0, 50.0));
        assert_eq!(padded_window(580.0, 598.0, 600.0), (570.0, 600.0));
        assert_eq!(padded_window(55.0, 12.0, 600.0), (2.0, 65.0));
    }

    #[test]
    fn file_names_round_trip_through_the_allowlist() {
        let name = studio_clip_file_name("source-revision", 2.0, 65.0);
        assert!(is_studio_clip_file_name(&name));
        assert!(is_studio_clip_file_name("clip-studio-2000-65000.mp4"));
        assert_ne!(name, studio_clip_file_name("new-revision", 2.0, 65.0));
        assert_ne!(name, studio_clip_file_name("source-revision", 2.0, 65.0001));
        assert!(!is_studio_clip_file_name("clip-studio-2000-65000.part.mp4"));
        assert!(!is_studio_clip_file_name("clip-studio--65000.mp4"));
        assert!(!is_studio_clip_file_name("clip-studio-2000-65000.mp4.exe"));
        assert!(!is_studio_clip_file_name("clip-trimmed.mp4"));
    }
}
