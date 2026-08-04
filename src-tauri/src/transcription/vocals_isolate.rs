//! UVR-MDX-NET-Voc_FT (ONNX) — isolate vocals before ASR.
//! Host STFT → ORT spectrogram core → iSTFT (UVR / audio-separator convention).

use crate::infra::model_cache::download_model_file_to_cache;
use crate::transcription::types::TranscriptionError;
use ort::session::Session;
use ort::value::Tensor;
use realfft::num_complex::Complex;
use realfft::RealFftPlanner;
use std::{
    f32::consts::PI,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};

const MODEL_DIR_NAME: &str = "uvr-mdx-net-voc-ft";
const MODEL_CDN_PREFIX: &str = "/models/uvr-mdx-net-voc-ft";
const ONNX_FILE: &str = "UVR-MDX-NET-Voc_FT.onnx";
const REQUIRED_FILES: [&str; 2] = ["config.json", ONNX_FILE];

const SAMPLE_RATE: u32 = 44_100;
const ASR_SAMPLE_RATE: u32 = 16_000;
const N_FFT: usize = 7_680;
const HOP: usize = 1_024;
const DIM_F: usize = 3_072;
const DIM_T: usize = 256;
const DIM_C: usize = 4;
const N_BINS: usize = N_FFT / 2 + 1;
const CHUNK_SIZE: usize = HOP * (DIM_T - 1);
const TRIM: usize = N_FFT / 2;
const GEN_SIZE: usize = CHUNK_SIZE - 2 * TRIM;

static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());
static ORT_INIT: Mutex<bool> = Mutex::new(false);
static SESSION_CACHE: Mutex<Option<CachedSession>> = Mutex::new(None);
static HANN_WINDOW: OnceLock<Vec<f32>> = OnceLock::new();

/// Drops the cached ORT session so ASR models can use GPU memory without contention.
pub fn release_cached_session() {
    if let Ok(mut cache) = SESSION_CACHE.lock() {
        *cache = None;
    }
}

struct CachedSession {
    onnx_path: PathBuf,
    session: Session,
    provider: String,
}

pub fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    for key in ["OPEN_CLIPPER_VOCALS_MODEL_DIR", "OPEN_CLIPPER_DEMUCS_MODEL_DIR"] {
        if let Ok(override_dir) = std::env::var(key) {
            let path = PathBuf::from(override_dir);
            if installed(&path) {
                return Ok(path);
            }
        }
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("models").join(MODEL_DIR_NAME))
        .map_err(|error| format!("Cannot resolve vocals model directory: {error}"))?;
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

fn force_cpu() -> bool {
    std::env::var("OPEN_CLIPPER_VOCALS_CPU").ok().as_deref() == Some("1")
        || std::env::var("OPEN_CLIPPER_DEMUCS_CPU").ok().as_deref() == Some("1")
}

fn prefer_directml() -> bool {
    #[cfg(windows)]
    {
        !force_cpu()
    }
    #[cfg(not(windows))]
    {
        false
    }
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
            if prefer_directml() {
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
        .map_err(|_| "Vocals model download lock poisoned".to_string())?;
    let path = model_dir(app)?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Nie udało się utworzyć katalogu modelu wokalu: {error}"))?;

    for file in REQUIRED_FILES {
        let local = path.join(file);
        let remote = format!("{MODEL_CDN_PREFIX}/{file}");
        download_model_file_to_cache(app, &local, &remote)
            .map_err(|error| format!("Nie udało się pobrać {file}: {error}"))?;
    }

    if !installed(&path) {
        return Err("Po pobraniu brakuje wymaganych plików modelu wokalu".to_string());
    }
    Ok(path)
}

pub fn delete_model(app: &AppHandle) -> Result<(), String> {
    let path = model_dir(app)?;
    if path.exists() {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("Nie udało się usunąć modelu wokalu: {error}"))?;
    }
    let mut cache = SESSION_CACHE
        .lock()
        .map_err(|_| "Session cache lock poisoned".to_string())?;
    *cache = None;
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
    log::info!("Vocals ORT loaded from {}", dll.display());
    ort::init_from(dll.to_string_lossy().as_ref())
        .map_err(|error| format!("Nie udało się załadować ONNX Runtime: {error}"))?
        .commit();
    *initialized = true;
    Ok(())
}

fn hann_periodic(n_fft: usize) -> Vec<f32> {
    (0..n_fft)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / n_fft as f32).cos()))
        .collect()
}

fn hann() -> &'static [f32] {
    HANN_WINDOW.get_or_init(|| hann_periodic(N_FFT)).as_slice()
}

fn reflect_pad(input: &[f32], pad: usize) -> Vec<f32> {
    if pad == 0 {
        return input.to_vec();
    }
    let n = input.len();
    if n == 0 {
        return vec![0.0; pad * 2];
    }
    if n == 1 {
        return vec![input[0]; pad * 2 + 1];
    }
    let mut out = vec![0.0f32; n + pad * 2];
    for i in 0..pad {
        let src = (i + 1).min(n - 1);
        out[pad - 1 - i] = input[src];
    }
    out[pad..pad + n].copy_from_slice(input);
    for i in 0..pad {
        let src = n.saturating_sub(2).saturating_sub(i);
        out[pad + n + i] = input[src];
    }
    out
}

fn stft_channel(
    samples: &[f32],
    planner: &mut RealFftPlanner<f32>,
    spectrum: &mut [f32],
) -> Result<(), String> {
    // samples length == CHUNK_SIZE; torch center=True → reflect pad TRIM each side.
    let padded = reflect_pad(samples, TRIM);
    let r2c = planner.plan_fft_forward(N_FFT);
    let mut scratch = r2c.make_scratch_vec();
    let window = hann();
    debug_assert_eq!(padded.len(), CHUNK_SIZE + N_FFT);

    for t in 0..DIM_T {
        let start = t * HOP;
        let mut frame = vec![0.0f32; N_FFT];
        for i in 0..N_FFT {
            frame[i] = padded[start + i] * window[i];
        }
        let mut complex = r2c.make_output_vec();
        r2c.process_with_scratch(&mut frame, &mut complex, &mut scratch)
            .map_err(|error| format!("STFT RFFT: {error}"))?;
        for f in 0..DIM_F {
            let bin = &complex[f];
            // Plane layout later packs re/im; store interleaved per-frame for now as [re,im] at (f,t)
            let base = (f * DIM_T + t) * 2;
            spectrum[base] = bin.re;
            spectrum[base + 1] = bin.im;
        }
    }
    Ok(())
}

fn pack_stereo_spectrogram(left_spec: &[f32], right_spec: &[f32]) -> Vec<f32> {
    // ONNX [1, 4, DIM_F, DIM_T] — L_re, L_im, R_re, R_im
    let mut out = vec![0.0f32; DIM_C * DIM_F * DIM_T];
    for f in 0..DIM_F {
        for t in 0..DIM_T {
            let src = (f * DIM_T + t) * 2;
            let dst_t = f * DIM_T + t;
            out[0 * DIM_F * DIM_T + dst_t] = left_spec[src];
            out[1 * DIM_F * DIM_T + dst_t] = left_spec[src + 1];
            out[2 * DIM_F * DIM_T + dst_t] = right_spec[src];
            out[3 * DIM_F * DIM_T + dst_t] = right_spec[src + 1];
        }
    }
    // UVR zeros the lowest 3 bins to reduce rumble.
    for c in 0..DIM_C {
        for f in 0..3.min(DIM_F) {
            for t in 0..DIM_T {
                out[c * DIM_F * DIM_T + f * DIM_T + t] = 0.0;
            }
        }
    }
    out
}

fn istft_channel(
    // planes: re and im as [DIM_F * DIM_T] each (freq-major, then time)
    re: &[f32],
    im: &[f32],
    planner: &mut RealFftPlanner<f32>,
) -> Result<Vec<f32>, String> {
    let c2r = planner.plan_fft_inverse(N_FFT);
    let mut scratch = c2r.make_scratch_vec();
    let window = hann();
    let padded_len = CHUNK_SIZE + N_FFT;
    let mut acc = vec![0.0f32; padded_len];
    let mut w_acc = vec![0.0f32; padded_len];

    for t in 0..DIM_T {
        let mut spectrum = c2r.make_input_vec();
        for f in 0..N_BINS {
            if f < DIM_F {
                let idx = f * DIM_T + t;
                spectrum[f] = Complex {
                    re: re[idx],
                    im: im[idx],
                };
            } else {
                spectrum[f] = Complex { re: 0.0, im: 0.0 };
            }
        }
        // realfft requires purely-real DC / Nyquist bins.
        spectrum[0].im = 0.0;
        if let Some(nyquist) = spectrum.last_mut() {
            nyquist.im = 0.0;
        }
        let mut frame = c2r.make_output_vec();
        c2r.process_with_scratch(&mut spectrum, &mut frame, &mut scratch)
            .map_err(|error| format!("iSTFT IRFFT: {error}"))?;
        // Match torch.istft (normalized=False): scale by 1/n_fft.
        let scale = 1.0 / N_FFT as f32;
        let start = t * HOP;
        for i in 0..N_FFT {
            let w = window[i];
            acc[start + i] += frame[i] * scale * w;
            w_acc[start + i] += w * w;
        }
    }

    let mut out = vec![0.0f32; CHUNK_SIZE];
    for i in 0..CHUNK_SIZE {
        let idx = i + TRIM;
        let denom = w_acc[idx].max(1e-8);
        out[i] = acc[idx] / denom;
    }
    Ok(out)
}

fn unpack_and_istft(
    pred: &[f32],
    planner: &mut RealFftPlanner<f32>,
) -> Result<(Vec<f32>, Vec<f32>), String> {
    let plane = DIM_F * DIM_T;
    if pred.len() < DIM_C * plane {
        return Err(format!(
            "Nieoczekiwany rozmiar wyjścia MDX: {} (need {})",
            pred.len(),
            DIM_C * plane
        ));
    }
    let l_re = &pred[0 * plane..1 * plane];
    let l_im = &pred[1 * plane..2 * plane];
    let r_re = &pred[2 * plane..3 * plane];
    let r_im = &pred[3 * plane..4 * plane];
    let left = istft_channel(l_re, l_im, planner)?;
    let right = istft_channel(r_re, r_im, planner)?;
    Ok((left, right))
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
    let want_dml = prefer_directml();

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
                log::warn!("Vocals DirectML unavailable, falling back to CPU: {error}");
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
        .map_err(|error| format!("Nie udało się załadować MDX ONNX: {error}"))?;
    Ok((session, provider_label))
}

fn check_cancelled(cancelled: Option<&AtomicBool>) -> Result<(), String> {
    if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
        return Err(TranscriptionError::Cancelled.to_string());
    }
    Ok(())
}

fn get_or_create_session(
    onnx_path: &Path,
) -> Result<(std::sync::MutexGuard<'static, Option<CachedSession>>, String, bool), String> {
    let mut cache = loop {
        match SESSION_CACHE.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err("Session cache lock poisoned".to_string());
            }
        }
    };
    let needs_rebuild = match cache.as_ref() {
        Some(cached) => cached.onnx_path != onnx_path,
        None => true,
    };
    if needs_rebuild {
        let (session, provider) = build_session(onnx_path)?;
        *cache = Some(CachedSession {
            onnx_path: onnx_path.to_path_buf(),
            session,
            provider: provider.clone(),
        });
        return Ok((cache, provider, true));
    }
    let provider = cache
        .as_ref()
        .map(|c| c.provider.clone())
        .unwrap_or_else(|| "cpu".into());
    Ok((cache, provider, false))
}

/// Isolate vocals using an explicit model directory (smoke / tests).
pub fn isolate_vocals_with_model(
    model_path: &Path,
    input_wav: &Path,
    output_wav: &Path,
    on_progress: Option<&mut dyn FnMut(f64) -> Result<(), String>>,
    cancelled: Option<&AtomicBool>,
) -> Result<String, String> {
    if !installed(model_path) {
        return Err(format!(
            "Model izolacji wokalu nie jest zainstalowany w {}",
            model_path.display()
        ));
    }
    isolate_vocals_at_model(
        model_path,
        input_wav,
        output_wav,
        on_progress,
        cancelled,
    )
}

/// Isolate vocals from `input_wav` into `output_wav` (16 kHz mono PCM for ASR).
pub fn isolate_vocals_to_wav(
    app: &AppHandle,
    input_wav: &Path,
    output_wav: &Path,
    on_progress: Option<&mut dyn FnMut(f64) -> Result<(), String>>,
    cancelled: Option<&AtomicBool>,
) -> Result<String, String> {
    let model_path = model_dir(app)?;
    if !installed(&model_path) {
        return Err(
            "Model izolacji wokalu nie jest zainstalowany. Pobierz go w ustawieniach transkrypcji."
                .into(),
        );
    }
    isolate_vocals_at_model(
        &model_path,
        input_wav,
        output_wav,
        on_progress,
        cancelled,
    )
}

fn isolate_vocals_at_model(
    model_path: &Path,
    input_wav: &Path,
    output_wav: &Path,
    mut on_progress: Option<&mut dyn FnMut(f64) -> Result<(), String>>,
    cancelled: Option<&AtomicBool>,
) -> Result<String, String> {
    let onnx_path = model_path.join(ONNX_FILE);

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    ensure_ort_loaded(&exe_dir)?;

    check_cancelled(cancelled)?;

    let (interleaved, sample_rate, channels) = read_wav_f32(input_wav)?;
    if channels == 0 {
        return Err("WAV nie ma kanałów".to_string());
    }
    let (left, right) = interleaved_to_planar_stereo(&interleaved, channels);
    let left = resample_linear(&left, sample_rate, SAMPLE_RATE);
    let right = resample_linear(&right, sample_rate, SAMPLE_RATE);
    let total_len = left.len().min(right.len());
    let left = &left[..total_len];
    let right = &right[..total_len];

    let peak = left
        .iter()
        .chain(right.iter())
        .map(|s| s.abs())
        .fold(0.0f32, f32::max)
        .max(1e-8);
    let left_n: Vec<f32> = left.iter().map(|s| s / peak).collect();
    let right_n: Vec<f32> = right.iter().map(|s| s / peak).collect();

    let (mut cache, active_provider, _session_rebuilt) = get_or_create_session(&onnx_path)?;
    let session = &mut cache
        .as_mut()
        .ok_or_else(|| "Brak sesji ORT".to_string())?
        .session;

    let n_sample = total_len;
    let pad = GEN_SIZE - (n_sample % GEN_SIZE);
    let mut mix_l = vec![0.0f32; TRIM + n_sample + pad + TRIM];
    let mut mix_r = vec![0.0f32; TRIM + n_sample + pad + TRIM];
    mix_l[TRIM..TRIM + n_sample].copy_from_slice(&left_n);
    mix_r[TRIM..TRIM + n_sample].copy_from_slice(&right_n);

    let mut out_l = vec![0.0f32; n_sample + pad];
    let mut out_r = vec![0.0f32; n_sample + pad];

    let chunk_count = ((n_sample + pad) / GEN_SIZE).max(1);
    let mut planner = RealFftPlanner::<f32>::new();
    let mut chunk_index = 0usize;
    let mut i = 0usize;
    while i < n_sample + pad {
        check_cancelled(cancelled)?;

        let end = i + CHUNK_SIZE;
        if end > mix_l.len() {
            break;
        }
        let chunk_l = &mix_l[i..end];
        let chunk_r = &mix_r[i..end];

        let mut left_spec = vec![0.0f32; DIM_F * DIM_T * 2];
        let mut right_spec = vec![0.0f32; DIM_F * DIM_T * 2];
        stft_channel(chunk_l, &mut planner, &mut left_spec)?;
        stft_channel(chunk_r, &mut planner, &mut right_spec)?;
        let spek = pack_stereo_spectrogram(&left_spec, &right_spec);

        let input_tensor = Tensor::from_array(([1usize, DIM_C, DIM_F, DIM_T], spek))
            .map_err(|error| format!("ORT input tensor: {error}"))?;
        let outputs = session
            .run(ort::inputs!["input" => input_tensor])
            .map_err(|error| format!("MDX inference: {error}"))?;
        let (_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("MDX output extract: {error}"))?;

        let (wav_l, wav_r) = unpack_and_istft(data, &mut planner)?;
        // Drop STFT edge trim; keep GEN_SIZE samples.
        let keep = &wav_l[TRIM..TRIM + GEN_SIZE];
        let keep_r = &wav_r[TRIM..TRIM + GEN_SIZE];
        let dst = i;
        if dst + GEN_SIZE <= out_l.len() {
            out_l[dst..dst + GEN_SIZE].copy_from_slice(keep);
            out_r[dst..dst + GEN_SIZE].copy_from_slice(keep_r);
        }

        chunk_index += 1;
        if let Some(callback) = on_progress.as_deref_mut() {
            let chunk_ratio = chunk_index as f64 / chunk_count as f64;
            // Reserve the final percent for post-processing (resample + WAV write).
            let display_ratio = (chunk_ratio * 0.99).min(0.99);
            callback(display_ratio)?;
        }
        i += GEN_SIZE;
    }

    // Release the session cache lock before post-processing so other jobs
    // cannot deadlock waiting for the same mutex.
    drop(cache);

    out_l.truncate(n_sample);
    out_r.truncate(n_sample);
    for sample in out_l.iter_mut().chain(out_r.iter_mut()) {
        *sample *= peak;
    }

    check_cancelled(cancelled)?;

    let mono = stereo_to_mono(&out_l, &out_r);
    let mono_16k = resample_linear(&mono, SAMPLE_RATE, ASR_SAMPLE_RATE);

    check_cancelled(cancelled)?;

    if let Some(parent) = output_wav.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Nie udało się utworzyć katalogu wyjściowego: {error}"))?;
    }

    if let Some(callback) = on_progress.as_deref_mut() {
        callback(0.995)?;
    }

    write_wav_f32_mono(output_wav, &mono_16k, ASR_SAMPLE_RATE)?;

    if let Some(callback) = on_progress.as_deref_mut() {
        callback(1.0)?;
    }

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
    fn chunk_geometry_matches_uvr() {
        assert_eq!(CHUNK_SIZE, 261_120);
        assert_eq!(TRIM, 3_840);
        assert_eq!(GEN_SIZE, 253_440);
        assert_eq!(N_BINS, 3_841);
    }

    #[test]
    fn resample_preserves_silence_length_ratio() {
        let input = vec![0.0f32; 44_100];
        let out = resample_linear(&input, 44_100, 16_000);
        assert!((out.len() as i32 - 16_000).abs() <= 1);
    }

    #[test]
    fn reflect_pad_symmetric() {
        let input = vec![1.0f32, 2.0, 3.0, 4.0];
        let padded = reflect_pad(&input, 2);
        assert_eq!(padded, vec![3.0, 2.0, 1.0, 2.0, 3.0, 4.0, 3.0, 2.0]);
    }

    #[test]
    fn gen_size_covers_full_track() {
        let total_len = 500_000usize;
        let pad = GEN_SIZE - (total_len % GEN_SIZE);
        let mut covered = 0usize;
        let mut i = 0usize;
        while i < total_len + pad {
            covered += GEN_SIZE;
            i += GEN_SIZE;
        }
        assert!(covered >= total_len);
    }
}
