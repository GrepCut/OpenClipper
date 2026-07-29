//! Smoke test for the production Whisper chunking path.

use tauri_app_lib::transcription::whisper_genai::{
    transcribe_model_dir, WHISPER_CHUNK_OVERLAP_SECONDS, WHISPER_CHUNK_SECONDS,
};
use std::env;
use std::path::Path;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: whisper_smoke <model_dir> <wav_path> [language]");
        std::process::exit(1);
    }

    let model_dir = Path::new(&args[1]);
    let wav_path = &args[2];
    let language = args.get(3).map(|s| s.as_str());

    println!("Whisper smoke test starting...");
    println!("Model dir: {}", model_dir.display());
    println!("WAV path: {}", wav_path);
    println!("Language: {}", language.unwrap_or("auto"));
    println!("Chunks: {WHISPER_CHUNK_SECONDS}s, overlap: {WHISPER_CHUNK_OVERLAP_SECONDS}s");

    match transcribe_model_dir(model_dir, wav_path, language) {
        Ok(result) => {
            println!("\n=== TRANSCRIPTION SUCCESS ===");
            println!("Text: {}", result.text);
            println!("Duration: {} ms, processing: {} ms, provider: {}", result.duration_ms, result.processing_time_ms, result.provider);
            println!("Words ({}):", result.words.len());
            for word in &result.words {
                println!("  [{:.3}-{:.3}] {}", word.start_time, word.end_time, word.text);
            }
            println!("Segments ({}):", result.segments.len());
            for segment in &result.segments {
                println!("  [{:.3}-{:.3}] {}", segment.start_time, segment.end_time, segment.text);
            }
        }
        Err(error) => {
            eprintln!("Whisper smoke test failed: {error}");
            std::process::exit(1);
        }
    }
}
