use crate::storage::repository::export_repository::ClipperExportRecord;

pub use crate::storage::export_social_util::{
    format_label, format_platform, missing_social_fields, publish_platform,
};

pub fn metadata_prompt_for_export(record: &ClipperExportRecord) -> String {
    let platform = format_platform(&record.format_id);
    let label = format_label(&record.format_id);
    let missing = missing_social_fields(record);
    let transcript = record.transcript_plain.trim();

    format!(
        r#"Generate social metadata for an Open Clipper video export.

Platform: {label} ({platform})
Format id: {format_id}
Clip index: {clip_index}
Export id: {export_id}
Source clip range (seconds): {clip_start} – {clip_end}

Transcript (plain):
{transcript}

Transcript (timestamped):
{transcript_ts}

Fields still empty: {missing}

Rules:
- Use the same language as the transcript (Polish or English).
- Do not invent facts not supported by the transcript.
- socialTitle: concise hook, ~70 characters max.
- socialShortDescription: ~150 characters max.
- socialDescription: fuller caption for the platform (multiple lines OK).
- socialDescriptionTimestamped: optional — same lines as description without [mm:ss] prefixes; the server assigns timestamps from the transcript.
- socialHashtags: 3–8 relevant hashtags separated by spaces, include # prefix.

Respond with JSON only (no markdown fences):
{{
  "socialTitle": "string",
  "socialShortDescription": "string",
  "socialDescription": "string",
  "socialDescriptionTimestamped": "string (optional, no timestamps)",
  "socialHashtags": "string"
}}

Then call patch_export_social_metadata with exportId "{export_id}" and the generated fields (mode: fill_missing)."#,
        label = label,
        platform = platform,
        format_id = record.format_id,
        clip_index = record.clip_index,
        export_id = record.id,
        clip_start = record
            .clip_start_sec
            .map(|v| v.to_string())
            .unwrap_or_else(|| "n/a".to_string()),
        clip_end = record
            .clip_end_sec
            .map(|v| v.to_string())
            .unwrap_or_else(|| "n/a".to_string()),
        transcript = if transcript.is_empty() {
            "(no transcript saved)"
        } else {
            transcript
        },
        transcript_ts = if record.transcript_timestamped.trim().is_empty() {
            "(none)"
        } else {
            record.transcript_timestamped.trim()
        },
        missing = if missing.is_empty() {
            "none — all fields populated".to_string()
        } else {
            missing.join(", ")
        },
    )
}

pub fn suggested_response_schema() -> serde_json::Value {
    serde_json::json!({
        "socialTitle": "string (max ~70 chars)",
        "socialShortDescription": "string (max ~150 chars)",
        "socialDescription": "string",
        "socialDescriptionTimestamped": "string (optional, lines without timestamps — server stamps)",
        "socialHashtags": "string (#tag1 #tag2)"
    })
}

pub fn publish_agent_prompt(graph_summary: &serde_json::Value) -> String {
    format!(
        r#"You are helping publish Open Clipper exports across social platforms.

Workflow:
1. Call `list_export_graph` to see all projects and export nodes (platform logos) with publish status.
2. For exports with missing metadata (`missingFields`), call `get_export_context` or `generate_export_metadata_prompt`, then `patch_export_social_metadata` (mode: fill_missing).
3. Prioritize exports that are ready (metadata complete, not yet published — no green check / `isPublished: false`).
4. Recommend publish order: complete metadata first, then upload per platform. User confirms uploads in the app Publish map or session exports view.

Current graph summary:
{summary}

Suggested next steps:
- Pick an export node with `isPublished: false` and empty `missingFields`.
- Use `get_export_node` for full context on a specific `exportId`.
- After metadata is ready, tell the user which export to publish and which channel (platform).

Do not invent upload URLs or claim a video is published unless `publishStatus.status` is `succeeded`."#,
        summary = serde_json::to_string_pretty(graph_summary).unwrap_or_else(|_| "{}".to_string()),
    )
}

pub fn build_export_graph(items: &[serde_json::Value]) -> serde_json::Value {
    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut links: Vec<serde_json::Value> = Vec::new();
    let mut project_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for item in items {
        let project_id = item
            .get("projectId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let project_name = item
            .get("projectName")
            .and_then(|v| v.as_str())
            .unwrap_or(&project_id)
            .to_string();
        let export_id = item
            .get("id")
            .or_else(|| item.get("exportId"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let clip_index = item
            .get("clipIndex")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let format_id = item
            .get("formatId")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let platform = item
            .get("platform")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| format_platform(format_id));
        let is_published = item
            .get("isPublished")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let missing_fields = item.get("missingFields").cloned().unwrap_or(serde_json::json!([]));

        if !project_ids.contains(&project_id) {
            project_ids.insert(project_id.clone());
            nodes.push(serde_json::json!({
                "id": format!("project:{project_id}"),
                "type": "project",
                "label": project_name,
                "projectId": project_id,
            }));
        }

        nodes.push(serde_json::json!({
            "id": export_id,
            "type": "export",
            "label": format_label(format_id),
            "projectId": project_id,
            "projectName": project_name,
            "clipIndex": clip_index,
            "formatId": format_id,
            "platform": platform,
            "isPublished": is_published,
            "missingFields": missing_fields,
        }));

        links.push(serde_json::json!({
            "source": format!("project:{project_id}"),
            "target": export_id,
            "type": "project-export",
        }));
    }

    serde_json::json!({
        "nodes": nodes,
        "links": links,
        "stats": {
            "projectCount": project_ids.len(),
            "exportCount": items.len(),
            "publishedCount": items.iter().filter(|item| {
                item.get("isPublished").and_then(|v| v.as_bool()) == Some(true)
            }).count(),
        }
    })
}
