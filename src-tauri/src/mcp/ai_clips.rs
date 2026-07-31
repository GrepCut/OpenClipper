use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::storage::repository::project_repository::ProjectRepository;
use crate::storage::repository::record_repository::RecordRepository;

const RANGE_WORDS_NS: &str = "clipper-range-words";
const CLIPS_NS: &str = "clipper-clips";

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsParams {
    #[serde(default = "default_rows")]
    pub rows: u32,
    #[serde(default)]
    pub skip: u32,
}

fn default_rows() -> u32 {
    20
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdParams {
    pub project_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpAiClipsPatchMode {
    /// Replace the full AI clip set (default).
    Overwrite,
    /// Append clips after existing AI clips.
    Append,
}

impl Default for McpAiClipsPatchMode {
    fn default() -> Self {
        Self::Overwrite
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpAiClipSegmentInput {
    pub word_start_idx: usize,
    pub word_end_idx: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpAiClipInput {
    pub segments: Vec<McpAiClipSegmentInput>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchAiClipsParams {
    pub project_id: String,
    pub clips: Vec<McpAiClipInput>,
    #[serde(default)]
    pub mode: McpAiClipsPatchMode,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WordCue {
    text: String,
    start: f64,
    end: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipSegmentPayload {
    order_index: usize,
    start_sec: f64,
    end_sec: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    word_start_idx: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    word_end_idx: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipPayload {
    index: usize,
    start_sec: f64,
    end_sec: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    segments: Vec<ClipSegmentPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListProjectsResponse {
    pub items: Vec<McpProjectSummary>,
    pub total: usize,
    pub skip: u32,
    pub rows: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProjectSummary {
    pub project_id: String,
    pub name: String,
    pub has_transcript: bool,
    pub ai_clip_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpTranscriptWord {
    i: usize,
    text: String,
    start: f64,
    end: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProjectTranscript {
    pub project_id: String,
    pub project_name: Option<String>,
    pub word_count: usize,
    pub duration_sec: f64,
    pub transcript_timestamped: String,
    words: Vec<McpTranscriptWord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAiClipsResponse {
    pub project_id: String,
    clips: Vec<ClipPayload>,
}

fn ai_clips_key(project_id: &str) -> String {
    format!("{project_id}:ai")
}

fn format_ts(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    let m = total / 60;
    let s = total % 60;
    format!("{m}:{s:02}")
}

async fn load_words_async(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<WordCue>, String> {
    let value = RecordRepository::get(database, RANGE_WORDS_NS.to_string(), project_id.to_string())
        .await
        .map_err(|e| e.to_string())?;
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    serde_json::from_value(value).map_err(|e| format!("Invalid range words payload: {e}"))
}

async fn load_ai_clips_async(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<ClipPayload>, String> {
    let value = RecordRepository::get(
        database,
        CLIPS_NS.to_string(),
        ai_clips_key(project_id),
    )
    .await
    .map_err(|e| e.to_string())?;
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    serde_json::from_value(value).map_err(|e| format!("Invalid AI clips payload: {e}"))
}

fn build_timestamped(words: &[WordCue]) -> String {
    words
        .iter()
        .map(|w| format!("[{}] {}", format_ts(w.start), w.text))
        .collect::<Vec<_>>()
        .join(" ")
}

fn clips_from_inputs(
    words: &[WordCue],
    inputs: &[McpAiClipInput],
    start_index: usize,
) -> Result<Vec<ClipPayload>, String> {
    if words.is_empty() {
        return Err("Project has no transcript. Transcribe the range in Open Clipper first.".into());
    }
    let last = words.len().saturating_sub(1);
    let mut out = Vec::with_capacity(inputs.len());

    for (offset, input) in inputs.iter().enumerate() {
        if input.segments.is_empty() {
            return Err(format!("Clip {} has no segments", start_index + offset));
        }
        let mut segments = Vec::with_capacity(input.segments.len());
        for (order_index, seg) in input.segments.iter().enumerate() {
            if seg.word_end_idx < seg.word_start_idx {
                return Err(format!(
                    "Clip {}: wordEndIdx ({}) < wordStartIdx ({})",
                    start_index + offset,
                    seg.word_end_idx,
                    seg.word_start_idx
                ));
            }
            if seg.word_start_idx > last || seg.word_end_idx > last {
                return Err(format!(
                    "Clip {}: word indices out of range (0..{last})",
                    start_index + offset
                ));
            }
            let start_sec = words[seg.word_start_idx].start;
            let end_sec = words[seg.word_end_idx].end;
            segments.push(ClipSegmentPayload {
                order_index,
                start_sec,
                end_sec,
                word_start_idx: Some(seg.word_start_idx),
                word_end_idx: Some(seg.word_end_idx),
            });
        }
        let start_sec = segments
            .iter()
            .map(|s| s.start_sec)
            .fold(f64::INFINITY, f64::min);
        let end_sec = segments
            .iter()
            .map(|s| s.end_sec)
            .fold(f64::NEG_INFINITY, f64::max);
        out.push(ClipPayload {
            index: start_index + offset,
            start_sec,
            end_sec,
            label: input
                .label
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            segments,
        });
    }
    Ok(out)
}

pub async fn list_projects_response(
    database: &DatabaseConnection,
    params: ListProjectsParams,
) -> Result<McpListProjectsResponse, String> {
    let summaries = ProjectRepository::list_summaries(database, Some("clipper"))
        .await
        .map_err(|e| e.to_string())?;
    let total = summaries.len();
    let skip = params.skip as usize;
    let rows = params.rows.max(1) as usize;
    let page = summaries.into_iter().skip(skip).take(rows);

    let mut items = Vec::new();
    for summary in page {
        let words = load_words_async(database, &summary.id).await?;
        let clips = load_ai_clips_async(database, &summary.id).await?;
        items.push(McpProjectSummary {
            project_id: summary.id,
            name: summary.name,
            has_transcript: !words.is_empty(),
            ai_clip_count: clips.len(),
        });
    }

    Ok(McpListProjectsResponse {
        items,
        total,
        skip: params.skip,
        rows: params.rows.max(1),
    })
}

pub async fn get_project_transcript_response(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<McpProjectTranscript, String> {
    let words = load_words_async(database, project_id).await?;
    if words.is_empty() {
        return Err(format!(
            "No transcript for project {project_id}. Open the project in Preview & customize after transcription."
        ));
    }

    let project_name = ProjectRepository::list_summaries(database, Some("clipper"))
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.id == project_id)
        .map(|p| p.name);

    let duration_sec = words.last().map(|w| w.end).unwrap_or(0.0);
    let mcp_words = words
        .iter()
        .enumerate()
        .map(|(i, w)| McpTranscriptWord {
            i,
            text: w.text.clone(),
            start: w.start,
            end: w.end,
        })
        .collect();

    Ok(McpProjectTranscript {
        project_id: project_id.to_string(),
        project_name,
        word_count: words.len(),
        duration_sec,
        transcript_timestamped: build_timestamped(&words),
        words: mcp_words,
    })
}

pub async fn get_ai_clips_response(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<McpAiClipsResponse, String> {
    let clips = load_ai_clips_async(database, project_id).await?;
    Ok(McpAiClipsResponse {
        project_id: project_id.to_string(),
        clips,
    })
}

pub async fn patch_ai_clips_response(
    database: &DatabaseConnection,
    params: PatchAiClipsParams,
) -> Result<McpAiClipsResponse, String> {
    let words = load_words_async(database, &params.project_id).await?;
    let existing = load_ai_clips_async(database, &params.project_id).await?;

    let next = match params.mode {
        McpAiClipsPatchMode::Overwrite => clips_from_inputs(&words, &params.clips, 0)?,
        McpAiClipsPatchMode::Append => {
            let start_index = existing.len();
            let mut merged = existing;
            merged.extend(clips_from_inputs(&words, &params.clips, start_index)?);
            merged
        }
    };

    let payload = serde_json::to_value(&next).map_err(|e| e.to_string())?;
    RecordRepository::put(
        database,
        CLIPS_NS.to_string(),
        ai_clips_key(&params.project_id),
        Some(params.project_id.clone()),
        payload,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(McpAiClipsResponse {
        project_id: params.project_id,
        clips: next,
    })
}

pub fn pretty_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_words() -> Vec<WordCue> {
        vec![
            WordCue {
                text: "hello".into(),
                start: 0.0,
                end: 0.4,
            },
            WordCue {
                text: "world".into(),
                start: 0.5,
                end: 0.9,
            },
            WordCue {
                text: "again".into(),
                start: 1.0,
                end: 1.4,
            },
        ]
    }

    #[test]
    fn clips_from_inputs_builds_word_indexed_payload() {
        let inputs = vec![McpAiClipInput {
            segments: vec![McpAiClipSegmentInput {
                word_start_idx: 0,
                word_end_idx: 1,
            }],
            label: Some("Hook".into()),
        }];
        let clips = clips_from_inputs(&sample_words(), &inputs, 0).unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].index, 0);
        assert_eq!(clips[0].start_sec, 0.0);
        assert_eq!(clips[0].end_sec, 0.9);
        assert_eq!(clips[0].label.as_deref(), Some("Hook"));
        assert_eq!(clips[0].segments[0].word_start_idx, Some(0));
        assert_eq!(clips[0].segments[0].word_end_idx, Some(1));
    }

    #[test]
    fn clips_from_inputs_rejects_out_of_range() {
        let inputs = vec![McpAiClipInput {
            segments: vec![McpAiClipSegmentInput {
                word_start_idx: 0,
                word_end_idx: 99,
            }],
            label: None,
        }];
        assert!(clips_from_inputs(&sample_words(), &inputs, 0).is_err());
    }
}
