use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::video::caption_gpu::{
    render_caption_png_sequence, resource_fonts_dir, CaptionGpuContext, CaptionScene,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCropPiece {
    pub source_start: f64,
    pub source_end: f64,
    pub sx: i32,
    pub sy: i32,
    pub sw: i32,
    pub sh: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioWindow {
    pub source_start: f64,
    pub source_end: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCropTimeline {
    pub output_width: u32,
    pub output_height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub pieces: Vec<NativeCropPiece>,
    #[serde(default)]
    pub audio_windows: Vec<NativeAudioWindow>,
    pub single_crop_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportResult {
    pub file_path: String,
    pub file_size: u64,
    pub encoder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeExportProgressPayload {
    job_id: String,
    ratio: f64,
}

#[derive(Debug, Clone, Copy)]
enum VideoEncoderKind {
    Nvenc,
    Qsv,
    Amf,
    X264,
}

impl VideoEncoderKind {
    fn codec_name(self) -> &'static str {
        match self {
            Self::Nvenc => "h264_nvenc",
            Self::Qsv => "h264_qsv",
            Self::Amf => "h264_amf",
            Self::X264 => "libx264",
        }
    }
}

fn export_cancel_map() -> &'static Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub fn cancel_native_export(job_id: &str) -> bool {
    let Ok(map) = export_cancel_map().lock() else {
        return false;
    };
    if let Some(flag) = map.get(job_id) {
        flag.store(true, Ordering::Release);
        return true;
    }
    false
}

fn register_cancel(job_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = export_cancel_map().lock() {
        map.insert(job_id.to_string(), flag.clone());
    }
    flag
}

fn unregister_cancel(job_id: &str) {
    if let Ok(mut map) = export_cancel_map().lock() {
        map.remove(job_id);
    }
}

fn resolve_ffmpeg_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("OPEN_CLIPPER_FFMPEG") {
        let candidate = PathBuf::from(path.trim());
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Ok(path) = std::env::var("FFMPEG_PATH") {
        let candidate = PathBuf::from(path.trim());
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for name in ["ffmpeg.exe", "ffmpeg"] {
            let candidate = resource_dir.join("bin").join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
            let candidate = resource_dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // Common local install used by this project's FFmpeg/vcpkg setup.
    #[cfg(windows)]
    {
        let local = PathBuf::from(r"C:\ffmpeg\bin\ffmpeg.exe");
        if local.is_file() {
            return Ok(local);
        }
    }

    // Fall back to PATH.
    Ok(PathBuf::from(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }))
}

fn probe_encoder(ffmpeg: &Path) -> Result<VideoEncoderKind, String> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("Cannot probe FFmpeg encoders: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let has = |name: &str| stdout.lines().any(|line| line.contains(name));

    // Prefer GPU encoders; verify NVENC can actually open before selecting it.
    for (kind, probe_name) in [
        (VideoEncoderKind::Nvenc, "h264_nvenc"),
        (VideoEncoderKind::Qsv, "h264_qsv"),
        (VideoEncoderKind::Amf, "h264_amf"),
    ] {
        if !has(probe_name) {
            continue;
        }
        if encoder_smoke_ok(ffmpeg, kind) {
            return Ok(kind);
        }
    }
    if has("libx264") {
        return Ok(VideoEncoderKind::X264);
    }
    Err("No usable H.264 encoder found in FFmpeg (need h264_nvenc/qsv/amf or libx264).".into())
}

fn encoder_smoke_ok(ffmpeg: &Path, kind: VideoEncoderKind) -> bool {
    let mut args = vec![
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:d=0.04",
        "-frames:v",
        "1",
        "-c:v",
        kind.codec_name(),
    ];
    let extra: Vec<&str> = match kind {
        VideoEncoderKind::Nvenc => vec!["-preset", "p4", "-cq", "23"],
        VideoEncoderKind::Qsv => vec!["-global_quality", "23"],
        VideoEncoderKind::Amf => vec!["-rc", "cqp", "-qp_i", "23", "-qp_p", "23"],
        VideoEncoderKind::X264 => vec!["-preset", "veryfast", "-crf", "23"],
    };
    args.extend(extra);
    args.extend(["-f", "null", "-"]);
    Command::new(ffmpeg)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn quality_to_cq(quality: &str) -> u32 {
    match quality {
        "draft" => 28,
        "high" => 19,
        _ => 23,
    }
}

fn escape_filter_path(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('\\', "/");
    s = s.replace(':', "\\:");
    s = s.replace('\'', "\\'");
    s = s.replace('[', "\\[").replace(']', "\\]");
    s = s.replace(',', "\\,");
    s
}

fn build_filter_complex(
    timeline: &NativeCropTimeline,
    ass_path: Option<&Path>,
    caption_overlay: Option<&Path>,
    caption_fps: Option<f64>,
    mute_audio: bool,
    has_audio: bool,
) -> Result<(String, Vec<&'static str>), String> {
    if timeline.pieces.is_empty() {
        return Err("Native crop timeline has no pieces.".into());
    }
    let out_w = timeline.output_width;
    let out_h = timeline.output_height;
    let mut lines: Vec<String> = Vec::new();
    let n = timeline.pieces.len();

    for (index, piece) in timeline.pieces.iter().enumerate() {
        let start = piece.source_start.max(0.0);
        let end = piece.source_end.max(start + 0.001);
        let max_w = timeline.source_width.max(2) as i32;
        let max_h = timeline.source_height.max(2) as i32;
        let sx = piece.sx.clamp(0, max_w - 2);
        let sy = piece.sy.clamp(0, max_h - 2);
        let sw = piece.sw.clamp(2, max_w - sx);
        let sh = piece.sh.clamp(2, max_h - sy);
        lines.push(format!(
            "[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,crop={sw}:{sh}:{sx}:{sy},scale={out_w}:{out_h}:flags=bicubic,setsar=1[v{index}]"
        ));
    }

    let concat_inputs: String = (0..n).map(|i| format!("[v{i}]")).collect();
    let needs_overlay = ass_path.is_some() || caption_overlay.is_some();
    let video_label = if needs_overlay { "vpre" } else { "vout" };
    lines.push(format!(
        "{concat_inputs}concat=n={n}:v=1:a=0[{video_label}]"
    ));

    if let Some(path) = caption_overlay {
        let escaped = escape_filter_path(path);
        lines.push(format!("[vpre][1:v]overlay=0:0:format=auto[vout]"));
        let _ = (escaped, caption_fps);
    } else if let Some(path) = ass_path {
        let escaped = escape_filter_path(path);
        lines.push(format!("[vpre]ass='{escaped}'[vout]"));
    }

    let mut maps = vec!["-map", "[vout]"];
    if has_audio && !mute_audio {
        let audio_windows = if timeline.audio_windows.is_empty() {
            // Fallback: one window spanning all crop pieces.
            let start = timeline
                .pieces
                .iter()
                .map(|p| p.source_start)
                .fold(f64::INFINITY, f64::min);
            let end = timeline
                .pieces
                .iter()
                .map(|p| p.source_end)
                .fold(f64::NEG_INFINITY, f64::max);
            vec![NativeAudioWindow {
                source_start: start,
                source_end: end,
            }]
        } else {
            timeline.audio_windows.clone()
        };
        let an = audio_windows.len();
        for (index, window) in audio_windows.iter().enumerate() {
            let start = window.source_start.max(0.0);
            let end = window.source_end.max(start + 0.001);
            lines.push(format!(
                "[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{index}]"
            ));
        }
        let a_inputs: String = (0..an).map(|i| format!("[a{i}]")).collect();
        lines.push(format!("{a_inputs}concat=n={an}:v=0:a=1[aout]"));
        maps.extend(["-map", "[aout]"]);
    }

    Ok((lines.join(";"), maps))
}

fn probe_has_audio(ffmpeg: &Path, input: &Path) -> bool {
    let output = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-i",
            &input.to_string_lossy(),
            "-hide_banner",
        ])
        .output();
    let Ok(output) = output else {
        return false;
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr.contains("Audio:")
}

fn parse_ffmpeg_time_seconds(line: &str) -> Option<f64> {
    // time=00:00:12.34
    let idx = line.find("time=")?;
    let rest = &line[idx + 5..];
    let token = rest.split_whitespace().next()?;
    if token.starts_with('-') || token == "N/A" {
        return None;
    }
    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn encoder_args(kind: VideoEncoderKind, quality: &str) -> Vec<String> {
    let cq = quality_to_cq(quality);
    match kind {
        VideoEncoderKind::Nvenc => vec![
            "-c:v".into(),
            "h264_nvenc".into(),
            "-preset".into(),
            "p4".into(),
            "-rc".into(),
            "vbr".into(),
            "-cq".into(),
            cq.to_string(),
            "-b:v".into(),
            "0".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ],
        VideoEncoderKind::Qsv => vec![
            "-c:v".into(),
            "h264_qsv".into(),
            "-global_quality".into(),
            cq.to_string(),
            "-look_ahead".into(),
            "1".into(),
            "-pix_fmt".into(),
            "nv12".into(),
        ],
        VideoEncoderKind::Amf => vec![
            "-c:v".into(),
            "h264_amf".into(),
            "-rc".into(),
            "cqp".into(),
            "-qp_i".into(),
            cq.to_string(),
            "-qp_p".into(),
            cq.to_string(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ],
        VideoEncoderKind::X264 => vec![
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            cq.to_string(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ],
    }
}

pub fn export_format_native_blocking(
    app: &AppHandle,
    job_id: &str,
    input_path: &Path,
    output_path: &Path,
    timeline: &NativeCropTimeline,
    ass_content: Option<&str>,
    caption_scene_json: Option<&str>,
    quality: &str,
    mute_audio: bool,
    duration_sec: f64,
) -> Result<NativeExportResult, String> {
    if !timeline.single_crop_only {
        return Err("Native export requires single-crop timeline.".into());
    }
    if !input_path.is_file() {
        return Err(format!("Input video not found: {}", input_path.display()));
    }
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create export dir: {e}"))?;
    }

    let cancelled = register_cancel(job_id);
    let _guard = CancelGuard {
        job_id: job_id.to_string(),
    };

    let ffmpeg = resolve_ffmpeg_binary(app)?;
    let encoder = probe_encoder(&ffmpeg)?;

    let temp_dir = output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(".native-export-{job_id}"));
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Temp dir error: {e}"))?;

    let ass_path = if caption_scene_json.is_some() {
        None
    } else if let Some(content) = ass_content.filter(|c| !c.trim().is_empty()) {
        let path = temp_dir.join("captions.ass");
        std::fs::write(&path, content).map_err(|e| format!("Cannot write ASS: {e}"))?;
        Some(path)
    } else {
        None
    };

    let caption_overlay_dir = temp_dir.join("caption_frames");
    let caption_overlay_pattern = caption_overlay_dir.join("captions_%06d.png");
    let caption_fps = if let Some(json) = caption_scene_json.filter(|j| !j.trim().is_empty()) {
        let scene: CaptionScene = serde_json::from_str(json)
            .map_err(|e| format!("Invalid caption scene JSON: {e}"))?;
        let fonts_dir = resource_fonts_dir(app);
        let mut gpu = CaptionGpuContext::for_scene(fonts_dir.as_deref(), &scene)?;
        let spec = render_caption_png_sequence(
            &mut gpu,
            &scene,
            &caption_overlay_dir,
            duration_sec,
        )?;
        Some((spec.fps, spec.frame_count))
    } else {
        None
    };

    let has_audio = probe_has_audio(&ffmpeg, input_path);
    let (filter_complex, map_args) = build_filter_complex(
        timeline,
        ass_path.as_deref(),
        if caption_fps.is_some() {
            Some(caption_overlay_pattern.as_path())
        } else {
            None
        },
        caption_fps.map(|(fps, _)| fps),
        mute_audio,
        has_audio,
    )?;

    let filter_path = temp_dir.join("filter.txt");
    {
        let mut file =
            std::fs::File::create(&filter_path).map_err(|e| format!("Filter file error: {e}"))?;
        file.write_all(filter_complex.as_bytes())
            .map_err(|e| format!("Filter write error: {e}"))?;
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        input_path.to_string_lossy().to_string(),
    ];
    if let Some((fps, _frame_count)) = caption_fps {
        args.extend([
            "-framerate".into(),
            format!("{fps:.3}"),
            "-start_number".into(),
            "0".into(),
            "-i".into(),
            caption_overlay_dir
                .join("captions_%06d.png")
                .to_string_lossy()
                .to_string(),
        ]);
    }
    args.extend([
        "-filter_complex_script".into(),
        filter_path.to_string_lossy().to_string(),
    ]);
    for map in map_args {
        args.push(map.to_string());
    }
    args.extend(encoder_args(encoder, quality));
    if has_audio && !mute_audio {
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    } else {
        args.push("-an".into());
    }
    args.extend([
        "-movflags".into(),
        "+faststart".into(),
        output_path.to_string_lossy().to_string(),
    ]);

    let mut child = Command::new(&ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg: {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "FFmpeg stderr unavailable".to_string())?;
    let mut reader = BufReader::new(stderr);
    let duration = duration_sec.max(0.001);
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut last_ratio = 0.0_f64;
    let mut stderr_tail = String::new();
    let mut buf = Vec::with_capacity(512);

    loop {
        if cancelled.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_dir_all(&temp_dir);
            let _ = std::fs::remove_file(output_path);
            return Err("cancelled".into());
        }
        buf.clear();
        // FFmpeg progress lines are typically delimited by \r, not \n.
        let read = reader.read_until(b'\r', &mut buf).map_err(|e| format!("FFmpeg stderr read: {e}"))?;
        if read == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&buf).replace('\n', " ");
        if stderr_tail.len() < 8_000 {
            stderr_tail.push_str(&line);
            stderr_tail.push('\n');
        }
        if let Some(t) = parse_ffmpeg_time_seconds(&line) {
            let ratio = (t / duration).clamp(0.0, 0.99);
            if ratio + 0.01 >= last_ratio || last_emit.elapsed() >= Duration::from_millis(200) {
                last_ratio = ratio;
                last_emit = Instant::now();
                let _ = app.emit(
                    "clipper-native-export-progress",
                    NativeExportProgressPayload {
                        job_id: job_id.to_string(),
                        ratio,
                    },
                );
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("FFmpeg wait error: {e}"))?;
    let _ = std::fs::remove_dir_all(&temp_dir);

    if cancelled.load(Ordering::Acquire) {
        let _ = std::fs::remove_file(output_path);
        return Err("cancelled".into());
    }
    if !status.success() {
        let _ = std::fs::remove_file(output_path);
        return Err(format!(
            "FFmpeg export failed ({}): {}",
            status.code().unwrap_or(-1),
            stderr_tail.chars().rev().take(1200).collect::<String>().chars().rev().collect::<String>()
        ));
    }

    let meta = std::fs::metadata(output_path).map_err(|e| format!("Output stat error: {e}"))?;
    let _ = app.emit(
        "clipper-native-export-progress",
        NativeExportProgressPayload {
            job_id: job_id.to_string(),
            ratio: 1.0,
        },
    );

    Ok(NativeExportResult {
        file_path: output_path.to_string_lossy().to_string(),
        file_size: meta.len(),
        encoder: encoder.codec_name().to_string(),
    })
}

struct CancelGuard {
    job_id: String,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        unregister_cancel(&self.job_id);
    }
}
