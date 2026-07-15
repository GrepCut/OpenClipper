use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionWord {
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    pub id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetTranscriptionResult {
    pub text: String,
    pub duration_ms: u64,
    pub processing_time_ms: u64,
    pub engine: String,
    pub words: Vec<TranscriptionWord>,
    pub segments: Vec<TranscriptionSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetModelStatus {
    pub installed: bool,
    pub loaded: bool,
    pub path: Option<String>,
    pub provider: Option<String>,
    pub source: Option<String>,
    pub manifest_valid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetCapability {
    pub available: bool,
    pub provider: Option<String>,
    pub model_installed: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetTranscriptionProgress {
    pub phase: String,
    pub chunk_index: usize,
    pub chunk_count: usize,
    pub ratio: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetTranscribeRequest {
    pub audio_path: String,
    pub language: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("Model lokalny nie jest zainstalowany")]
    ModelNotInstalled,

    #[error("Nie udało się załadować modelu: {0}")]
    ModelLoad(String),

    #[error("Nieprawidłowe audio: {0}")]
    InvalidAudio(String),

    #[error("Błąd inferencji: {0}")]
    Inference(String),

    #[error("Transkrypcja została anulowana")]
    Cancelled,
}
