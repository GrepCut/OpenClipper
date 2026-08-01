//! Smoke: UVR-MDX-NET-Voc_FT vocals isolate vs mix baseline length/energy.
//!
//! Usage:
//!   cargo run --example vocals_isolate_smoke --release -- [wav_path]
//!
//! Without wav_path, synthesizes a short stereo "song-like" mix (tone + noise).

use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use std::env;
use std::f32::consts::PI;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri_app_lib::transcription::vocals_isolate::isolate_vocals_with_model;

fn default_model_dir() -> PathBuf {
    for key in ["OPEN_CLIPPER_VOCALS_MODEL_DIR", "OPEN_CLIPPER_DEMUCS_MODEL_DIR"] {
        if let Ok(path) = env::var(key) {
            return PathBuf::from(path);
        }
    }
    let appdata = env::var("APPDATA").ok().map(PathBuf::from);
    if let Some(root) = appdata {
        let cached = root
            .join("com.openclipper.app")
            .join("models")
            .join("uvr-mdx-net-voc-ft");
        if cached.join("UVR-MDX-NET-Voc_FT.onnx").is_file() {
            return cached;
        }
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("public")
        .join("models")
        .join("uvr-mdx-net-voc-ft")
}

fn write_synthetic_mix(path: &Path, seconds: f32) -> Result<(), String> {
    let sample_rate = 44_100u32;
    let frames = (seconds * sample_rate as f32) as usize;
    let spec = WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer =
        WavWriter::create(path, spec).map_err(|error| format!("create wav: {error}"))?;
    for i in 0..frames {
        let t = i as f32 / sample_rate as f32;
        // "Vocal-ish" mid tone + "beat" low pulse noise — MDX should prefer the tone.
        let vocal = 0.35 * (2.0 * PI * 220.0 * t).sin();
        let beat = 0.25 * (2.0 * PI * 90.0 * t).sin() * ((2.0 * PI * 2.0 * t).sin().max(0.0));
        let noise = 0.05 * (((i * 1103515245 + 12345) % 1000) as f32 / 500.0 - 1.0);
        let left = (vocal + beat + noise).clamp(-1.0, 1.0);
        let right = (vocal * 0.9 + beat * 1.1 + noise).clamp(-1.0, 1.0);
        writer
            .write_sample((left * i16::MAX as f32) as i16)
            .map_err(|error| format!("write: {error}"))?;
        writer
            .write_sample((right * i16::MAX as f32) as i16)
            .map_err(|error| format!("write: {error}"))?;
    }
    writer
        .finalize()
        .map_err(|error| format!("finalize: {error}"))?;
    Ok(())
}

fn wav_rms_and_len(path: &Path) -> Result<(usize, f32), String> {
    let mut reader = WavReader::open(path).map_err(|error| format!("open: {error}"))?;
    let samples: Vec<i16> = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read: {error}"))?;
    if samples.is_empty() {
        return Ok((0, 0.0));
    }
    let sum_sq: f64 = samples
        .iter()
        .map(|s| {
            let v = *s as f64 / i16::MAX as f64;
            v * v
        })
        .sum();
    let rms = (sum_sq / samples.len() as f64).sqrt() as f32;
    Ok((samples.len(), rms))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let model_dir = default_model_dir();
    let temp_dir = env::temp_dir().join("open-clipper-vocals-smoke");
    let _ = std::fs::create_dir_all(&temp_dir);

    let input_wav = if let Some(path) = args.get(1) {
        PathBuf::from(path)
    } else {
        let path = temp_dir.join("synthetic-mix.wav");
        println!("Synthesizing ~8s stereo mix at {}", path.display());
        if let Err(error) = write_synthetic_mix(&path, 8.0) {
            eprintln!("Failed to write synthetic mix: {error}");
            std::process::exit(1);
        }
        path
    };

    let output_wav = temp_dir.join("vocals-16k.wav");
    println!("Model: {}", model_dir.display());
    println!("Input: {}", input_wav.display());
    println!("Output: {}", output_wav.display());

    let started = Instant::now();
    match isolate_vocals_with_model(&model_dir, &input_wav, &output_wav, None, None) {
        Ok(provider) => {
            let elapsed = started.elapsed();
            match wav_rms_and_len(&output_wav) {
                Ok((len, rms)) => {
                    let expected_16k = {
                        let (mix_len, _) = wav_rms_and_len(&input_wav).unwrap_or((0, 0.0));
                        let channels = WavReader::open(&input_wav)
                            .map(|r| r.spec().channels as usize)
                            .unwrap_or(2)
                            .max(1);
                        let input_frames = mix_len / channels;
                        let in_rate = WavReader::open(&input_wav)
                            .map(|r| r.spec().sample_rate as u64)
                            .unwrap_or(44_100);
                        ((input_frames as u64 * 16_000) / in_rate) as i64
                    };
                    let len_ok = (len as i64 - expected_16k).abs() <= 2;
                    println!("\n=== VOCALS ISOLATE SUCCESS ===");
                    println!("provider={provider}");
                    println!("elapsed={elapsed:?}");
                    println!("output_samples={len} expected≈{expected_16k} length_ok={len_ok}");
                    println!("output_rms={rms:.6}");
                    if !len_ok {
                        eprintln!("Smoke failed: output length mismatch");
                        std::process::exit(1);
                    }
                    if rms < 1e-6 {
                        eprintln!("Smoke warning: near-silent vocals output (rms={rms})");
                    }
                    println!("Baseline note: mix→ASR without isolate uses the input WAV unchanged.");
                }
                Err(error) => {
                    eprintln!("Could not inspect output: {error}");
                    std::process::exit(1);
                }
            }
        }
        Err(error) => {
            eprintln!("Vocals isolate smoke failed: {error}");
            std::process::exit(1);
        }
    }
}
