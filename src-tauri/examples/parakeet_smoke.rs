//! Smoke test: load Parakeet INT8 and transcribe a WAV file.
//!
//! Usage:
//!   cargo run --example parakeet_smoke -- <model_dir> <wav_path>
//!
//! Example:
//!   cargo run --example parakeet_smoke -- \
//!     "public/models/nemo-parakeet-tdt-0.6b-v3-int8" \
//!     "public/models/nemo-parakeet-tdt-0.6b-v3-int8/test_wavs/de.wav"

use tauri_app_lib::transcription::parakeet_probe::{default_thread_count, select_provider};
use tauri_app_lib::transcription::parakeet_provider::ParakeetProvider;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: parakeet_smoke <model_dir> <wav_path>");
        std::process::exit(1);
    }

    let model_dir = &args[1];
    let wav_path = &args[2];
    let threads = default_thread_count();
    let (provider, _) = select_provider(std::path::Path::new(model_dir), threads);

    println!("Loading model from: {model_dir}");
    println!("Provider: {provider} (threads={threads})");
    let provider = match ParakeetProvider::load_with_provider(model_dir, &provider, threads) {
        Ok(provider) => provider,
        Err(error) => {
            eprintln!("Failed to load model: {error}");
            std::process::exit(1);
        }
    };

    println!("Transcribing: {wav_path}");
    match provider.transcribe_wav(wav_path) {
        Ok(result) => {
            println!("Text: {}", result.text);
            println!(
                "Duration: {} ms, processing: {} ms",
                result.duration_ms, result.processing_time_ms
            );
            println!("Words ({}):", result.words.len());
            for word in &result.words {
                println!(
                    "  [{:.3}-{:.3}] {}",
                    word.start_time, word.end_time, word.text
                );
            }
            println!("Segments ({}):", result.segments.len());
            for segment in &result.segments {
                println!(
                    "  [{:.3}-{:.3}] {}",
                    segment.start_time, segment.end_time, segment.text
                );
            }
        }
        Err(error) => {
            eprintln!("Transcription failed: {error}");
            std::process::exit(1);
        }
    }
}
