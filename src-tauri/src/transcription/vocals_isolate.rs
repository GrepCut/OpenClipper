//! HT-Demucs FT vocals specialist (ONNX) — isolate vocals before ASR.
//! Reference: StemSplitio/htdemucs-ft-vocals-onnx `infer.py` (overlap-add chunking).

use crate::infra::model_cache::download_model_file_to_cache;
use ort::session::Session;
use ort::value::Tensor;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const MODEL_DIR_NAME: &str = "htdemucs-ft-vocals-onnx";
const MODEL_CDN_PREFIX: &str = "/models/htdemucs-ft-vocals-onnx";
const REQUIRED_FILES: [&str; 2] = ["config.json", "htdemucs_ft_vocals.onnx"];

const SAMPLE_RATE: u32 = 44_100;
const SEGMENT_SAMPLES: usize = 343_980; // 7.8 s @ 44.1 kHz
const ASR_SAMPLE_RATE: u32 = 16_000;
const VOCALS_STEM_INDEX: usize = 3;
const N_SOURCES: usize = 4;
const N_CHANNELS: usize = 2;

static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());
static ORT_INIT: Mutex<bool> = Mutex::new(false);

pub fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var("OPEN_CLIPPER_DEMUCS_MODEL_DIR") {
        let path = PathBuf::from(override_dir);
        if installed(&path) {
            return Ok(path);
        }
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("models").join(MODEL_DIR_NAME))
        .map_err(|error| format!("Cannot resolve Demucs model directory: {error}"))?;
    if installed(&app_data) {
        return Ok(app_data);
    }

    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("public")
        .join("models")
        .join(MODEL_DIR_NAME);
    if installed(&dev) {
        return Ok(dev);
    }

    Ok(app_data)
}

fn installed(path: &Path) -> bool {
    REQUIRED_FILES.iter().all(|file| path.join(file).is_file())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocalsIsolateModelStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub provider: Option<String>,
}

pub fn model_status(app: &AppHandle) -> Result<VocalsIsolateModelStatus, String> {
    let path = model_dir(app)?;
    let is_installed = installed(&path);
    Ok(VocalsIsolateModelStatus {
        installed: is_installed,
        path: is_installed.then(|| path.display().to_string()),
        provider: is_installed.then(|| {
            if std::env::var("OPEN_CLIPPER_DEMUCS_DML").ok().as_deref() == Some("1") {
                "GPU (DirectML)".to_owned()
            } else {
                "CPU".to_owned()
            }
        }),
    })
}

pub fn download_and_install_model(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = DOWNLOAD_LOCK
        .lock()
        .map_err(|_| "Demucs download lock poisoned".to_string())?;
    let path = model_dir(app)?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Nie udało się utworzyć katalogu Demucs: {error}"))?;

    for file in REQUIRED_FILES {
        let local = path.join(file);
        let remote = format!("{MODEL_CDN_PREFIX}/{file}");
        download_model_file_to_cache(app, &local, &remote)
            .map_err(|error| format!("Nie udało się pobrać Demucs {file}: {error}"))?;
    }

    if !installed(&path) {
        return Err("Po pobraniu brakuje wymaganych plików Demucs".to_string());
    }
    Ok(path)
}

pub fn delete_model(app: &AppHandle) -> Result<(), String> {
    let path = model_dir(app)?;
    if path.exists() {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("Nie udało się usunąć Demucs: {error}"))?;
    }
    Ok(())
}

fn ensure_ort_loaded(exe_dir: &Path) -> Result<(), String> {
    let mut initialized = ORT_INIT
        .lock()
        .map_err(|_| "ORT init lock poisoned".to_string())?;
    if *initialized {
        return Ok(());
    }

    // Sherpa stages ORT 1.14 as onnxruntime.dll next to the exe; ort 2.x needs
    // >= 1.17. Prefer a distinctly named 1.23 build (or the third_party tree).
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("OPEN_CLIPPER_ORT_DLL") {
        candidates.push(PathBuf::from(path));
    }
    candidates.push(exe_dir.join("onnxruntime_ort.dll"));
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("third_party")
            .join("onnxruntime-directml")
            .join("1.23.0")
            .join("runtimes")
            .join("win-x64")
            .join("native")
            .join("onnxruntime.dll"),
    );

    let dll = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Nie znaleziono onnxruntime_ort.dll (third_party/onnxruntime-directml/1.23.0 lub obok exe)"
                .to_string()
        })?;
    log::info!("Demucs ORT loaded from {}", dll.display());
    ort::init_from(dll.to_string_lossy().as_ref())
        .map_err(|error| format!("Nie udało się załadować ONNX Runtime: {error}"))?
        .commit();
    *initialized = true;
    Ok(())
}

fn transition_window(segment: usize, overlap_frac: f32) -> Vec<f32> {
    let transition = ((segment as f32) * overlap_frac).round() as usize;
    let mut window = vec![1.0f32; segment];
    if transition == 0 {
        return window;
    }
    for i in 0..transition {
        let fade = i as f32 / transition as f32;
        window[i] = fade;
        window[segment - 1 - i] = fade;
    }
    window
}

fn read_wav_f32(path: &Path) -> Result<(Vec<f32>, u32, u16), String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|error| format!("Nie udało się otworzyć WAV: {error}"))?;
    let spec = reader.spec();
    let samples: Result<Vec<f32>, _> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect(),
        hound::SampleFormat::Int => {
            let max = (1u32 << (spec.bits_per_sample.saturating_sub(1))) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max))
                .collect()
        }
    };
    let interleaved = samples.map_err(|error| format!("Błąd odczytu próbek WAV: {error}"))?;
    Ok((interleaved, spec.sample_rate, spec.channels))
}

fn write_wav_f32_mono(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|error| format!("Nie udało się utworzyć WAV: {error}"))?;
    for &sample in samples {
        let clipped = sample.clamp(-1.0, 1.0);
        let i = (clipped * i16::MAX as f32).round() as i16;
        writer
            .write_sample(i)
            .map_err(|error| format!("Zapis próbki WAV: {error}"))?;
    }
    writer
        .finalize()
        .map_err(|error| format!("Finalizacja WAV: {error}"))?;
    Ok(())
}

fn interleaved_to_planar_stereo(interleaved: &[f32], channels: u16) -> (Vec<f32>, Vec<f32>) {
    if channels == 1 {
        return (interleaved.to_vec(), interleaved.to_vec());
    }
    let frames = interleaved.len() / channels as usize;
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for frame in 0..frames {
        let base = frame * channels as usize;
        left.push(interleaved[base]);
        right.push(if channels as usize > 1 {
            interleaved[base + 1]
        } else {
            interleaved[base]
        });
    }
    (left, right)
}

fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let out_len = ((input.len() as u64 * to_rate as u64) / from_rate as u64).max(1) as usize;
    let mut out = vec![0.0f32; out_len];
    let scale = (input.len() - 1) as f64 / (out_len - 1).max(1) as f64;
    for (i, sample) in out.iter_mut().enumerate() {
        let src = i as f64 * scale;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = input[idx];
        let b = input.get(idx + 1).copied().unwrap_or(a);
        *sample = a + (b - a) * frac;
    }
    out
}

fn stereo_to_mono(left: &[f32], right: &[f32]) -> Vec<f32> {
    left.iter()
        .zip(right.iter())
        .map(|(l, r)| (l + r) * 0.5)
        .collect()
}

fn build_session(onnx_path: &Path) -> Result<(Session, String), String> {
    let want_dml = std::env::var("OPEN_CLIPPER_DEMUCS_DML").ok().as_deref() == Some("1");

    let builder = Session::builder()
        .map_err(|error| format!("ORT session builder: {error}"))?
        .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
        .map_err(|error| format!("ORT optimization: {error}"))?;

    let mut provider_label = "cpu".to_owned();
    #[cfg(windows)]
    let mut builder = if want_dml {
        let providers = [ort::ep::DirectML::default().build()];
        match builder.with_execution_providers(providers) {
            Ok(configured) => {
                provider_label = "directml".to_owned();
                configured
            }
            Err(error) => {
                log::warn!("Demucs DirectML unavailable, falling back to CPU: {error}");
                Session::builder()
                    .map_err(|error| format!("ORT session builder: {error}"))?
                    .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
                    .map_err(|error| format!("ORT optimization: {error}"))?
            }
        }
    } else {
        builder
    };
    #[cfg(not(windows))]
    let mut builder = {
        let _ = want_dml;
        builder
    };

    let session = builder
        .commit_from_file(onnx_path)
        .map_err(|error| format!("Nie udało się załadować Demucs ONNX: {error}"))?;
    Ok((session, provider_label))
}

/// Isolate vocals using an explicit model directory (smoke / tests).
pub fn isolate_vocals_with_model(
    model_path: &Path,
    input_wav: &Path,
    output_wav: &Path,
    on_progress: Option<&mut dyn FnMut(f64) -> Result<(), String>>,
) -> Result<String, String> {
    if !installed(model_path) {
        return Err(format!(
            "Model izolacji wokalu nie jest zainstalowany w {}",
            model_path.display()
        ));
    }
    isolate_vocals_at_model(model_path, input_wav, output_wav, on_progress)
}

/// Isolate vocals from `input_wav` into `output_wav` (16 kHz mono PCM for ASR).
pub fn isolate_vocals_to_wav(
    app: &AppHandle,
    input_wav: &Path,
    output_wav: &Path,
    on_progress: Option<&mut dyn FnMut(f64) -> Result<(), String>>,
) -> Result<String, String> {
    let model_path = model_dir(app)?;
    if !installed(&model_path) {
        return Err(
            "Model izolacji wokalu nie jest zainstalowany. Pobierz go w ustawieniach transkrypcji."
                .into(),
        );
    }
    isolate_vocals_at_model(&model_path, input_wav, output_wav, on_progress)
}

fn isolate_vocals_at_model(
    model_path: &Path,
    input_wav: &Path,
    output_wav: &Path,
    mut on_progress: Option<&mut dyn FnMut(f64) -> Result<(), String>>,
) -> Result<String, String> {
    let onnx_path = model_path.join("htdemucs_ft_vocals.onnx");

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    ensure_ort_loaded(&exe_dir)?;

    let (interleaved, sample_rate, channels) = read_wav_f32(input_wav)?;
    if channels == 0 {
        return Err("WAV nie ma kanałów".into());
    }
    let (left, right) = interleaved_to_planar_stereo(&interleaved, channels);
    let left = resample_linear(&left, sample_rate, SAMPLE_RATE);
    let right = resample_linear(&right, sample_rate, SAMPLE_RATE);
    let total_len = left.len().min(right.len());
    let left = &left[..total_len];
    let right = &right[..total_len];

    let (mut session, active_provider) = build_session(&onnx_path)?;

    let overlap = SEGMENT_SAMPLES / 4;
    let stride = SEGMENT_SAMPLES - overlap;
    let n_chunks = ((total_len + stride - 1) / stride).max(1);
    let window = transition_window(SEGMENT_SAMPLES, 0.25);

    let mut out_left = vec![0.0f32; total_len];
    let mut out_right = vec![0.0f32; total_len];
    let mut weight = vec![0.0f32; total_len];

    for chunk_index in 0..n_chunks {
        let start = chunk_index * stride;
        if start >= total_len {
            break;
        }
        let end = (start + SEGMENT_SAMPLES).min(total_len);
        let chunk_len = end - start;

        let mut mix = vec![0.0f32; N_CHANNELS * SEGMENT_SAMPLES];
        for i in 0..chunk_len {
            mix[i] = left[start + i];
            mix[SEGMENT_SAMPLES + i] = right[start + i];
        }

        let input_tensor = Tensor::from_array(([1usize, N_CHANNELS, SEGMENT_SAMPLES], mix))
            .map_err(|error| format!("ORT input tensor: {error}"))?;

        let outputs = session
            .run(ort::inputs![input_tensor])
            .map_err(|error| format!("Demucs inference: {error}"))?;

        let (_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("Demucs output extract: {error}"))?;

        // Expected (1, 4, 2, SEGMENT_SAMPLES) — row-major.
        let expected = N_SOURCES * N_CHANNELS * SEGMENT_SAMPLES;
        if data.len() < expected {
            return Err(format!(
                "Nieoczekiwany rozmiar stems: got {} need >= {expected}",
                data.len()
            ));
        }

        let stem_stride = N_CHANNELS * SEGMENT_SAMPLES;
        let vocals_base = VOCALS_STEM_INDEX * stem_stride;
        for i in 0..chunk_len {
            let w = window[i];
            let vl = data[vocals_base + i];
            let vr = data[vocals_base + SEGMENT_SAMPLES + i];
            out_left[start + i] += vl * w;
            out_right[start + i] += vr * w;
            weight[start + i] += w;
        }

        if let Some(callback) = on_progress.as_deref_mut() {
            callback((chunk_index + 1) as f64 / n_chunks as f64)?;
        }
    }

    for i in 0..total_len {
        let w = weight[i].max(1e-8);
        out_left[i] /= w;
        out_right[i] /= w;
    }

    let mono = stereo_to_mono(&out_left, &out_right);
    let mono_16k = resample_linear(&mono, SAMPLE_RATE, ASR_SAMPLE_RATE);
    if let Some(parent) = output_wav.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Nie udało się utworzyć katalogu wyjściowego: {error}"))?;
    }
    write_wav_f32_mono(output_wav, &mono_16k, ASR_SAMPLE_RATE)?;
    Ok(active_provider)
}

/// Path for vocals WAV next to the clip mix WAV.
pub fn vocals_output_path(input_wav: &Path) -> PathBuf {
    input_wav
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("transcribe-audio-vocals.wav")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_window_fades_edges() {
        let window = transition_window(100, 0.25);
        assert_eq!(window.len(), 100);
        assert!(window[0] < 0.1);
        assert!((window[50] - 1.0).abs() < 1e-5);
        assert!(window[99] < 0.1);
    }

    #[test]
    fn resample_preserves_silence_length_ratio() {
        let input = vec![0.0f32; 44_100];
        let out = resample_linear(&input, 44_100, 16_000);
        assert!((out.len() as i32 - 16_000).abs() <= 1);
    }

    #[test]
    fn overlap_add_length_matches_input() {
        let total_len = 50_000usize;
        let overlap = SEGMENT_SAMPLES / 4;
        let stride = SEGMENT_SAMPLES - overlap;
        let n_chunks = ((total_len + stride - 1) / stride).max(1);
        let mut covered = vec![false; total_len];
        for chunk_index in 0..n_chunks {
            let start = chunk_index * stride;
            if start >= total_len {
                break;
            }
            let end = (start + SEGMENT_SAMPLES).min(total_len);
            for i in start..end {
                covered[i] = true;
            }
        }
        assert!(covered.iter().all(|&c| c));
    }
}
