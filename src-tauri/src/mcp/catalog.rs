use rmcp::model::Tool;
use serde::Serialize;
use serde_json::Value;

use crate::mcp::server::list_registered_mcp_tools;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCatalogEntry {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_example: Value,
    pub output_example: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolsCatalog {
    pub instructions: String,
    pub tools: Vec<McpToolCatalogEntry>,
}

const MCP_INSTRUCTIONS: &str = "Open Clipper MCP (local SQLite, no login). Clip picking: list_projects → get_project_transcript → patch_ai_clips. Export metadata: list_exports → get_export_details → patch_export_social_metadata. Prefer stdio transport in Cursor (not HTTP URL).";

pub fn build_mcp_tools_catalog() -> McpToolsCatalog {
    let tools = list_registered_mcp_tools()
        .into_iter()
        .map(tool_to_catalog_entry)
        .collect();

    McpToolsCatalog {
        instructions: MCP_INSTRUCTIONS.to_string(),
        tools,
    }
}

fn tool_to_catalog_entry(tool: Tool) -> McpToolCatalogEntry {
    let (input_example, output_example) = examples_for_tool(tool.name.as_ref());
    McpToolCatalogEntry {
        name: tool.name.to_string(),
        description: tool.description.map(|description| description.to_string()),
        input_example,
        output_example,
    }
}

fn examples_for_tool(name: &str) -> (Value, Value) {
    match name {
        "list_exports" => (
            serde_json::json!({
                "projectId": "proj-abc-123",
                "status": "incomplete",
                "hasTranscript": true,
                "skip": 0,
                "rows": 20,
                "sort": "newest"
            }),
            serde_json::json!({
                "items": [
                    {
                        "exportId": "exp-001",
                        "projectId": "proj-abc-123",
                        "projectName": "My Podcast Episode",
                        "clipIndex": 0,
                        "platform": "youtube",
                        "exportedAt": "2026-01-15T10:30:00Z",
                        "status": "incomplete"
                    }
                ],
                "total": 1,
                "skip": 0,
                "rows": 20
            }),
        ),
        "get_export_details" => (
            serde_json::json!({
                "exportId": "exp-001"
            }),
            serde_json::json!({
                "exportId": "exp-001",
                "projectId": "proj-abc-123",
                "platform": "tiktok",
                "exportedAt": "2026-01-15T10:30:00Z",
                "transcriptTimestamped": "[0:00] Today I want to show you\n[0:03] three tips for better clips.",
                "title": null,
                "description": null,
                "hashtags": null
            }),
        ),
        "patch_export_social_metadata" => (
            serde_json::json!({
                "exportId": "exp-001",
                "title": "3 clip tips you need",
                "description": "Quick breakdown of what makes a short perform.",
                "hashtags": "#videoediting #shorts #tips",
                "mode": "fill_missing"
            }),
            serde_json::json!({
                "exportId": "exp-001",
                "title": "3 clip tips you need",
                "description": "Quick breakdown of what makes a short perform.",
                "hashtags": "#videoediting #shorts #tips"
            }),
        ),
        "list_projects" => (
            serde_json::json!({
                "skip": 0,
                "rows": 20
            }),
            serde_json::json!({
                "items": [
                    {
                        "projectId": "proj-abc-123",
                        "name": "My Podcast Episode",
                        "hasTranscript": true,
                        "aiClipCount": 0
                    }
                ],
                "total": 1,
                "skip": 0,
                "rows": 20
            }),
        ),
        "get_project_transcript" => (
            serde_json::json!({
                "projectId": "proj-abc-123"
            }),
            serde_json::json!({
                "projectId": "proj-abc-123",
                "projectName": "My Podcast Episode",
                "wordCount": 3,
                "durationSec": 4.2,
                "transcriptTimestamped": "[0:00] You're [0:01] welcome [0:02] bro",
                "words": [
                    { "i": 0, "text": "You're", "start": 0.0, "end": 0.4 },
                    { "i": 1, "text": "welcome", "start": 0.5, "end": 1.1 },
                    { "i": 2, "text": "bro", "start": 1.2, "end": 1.6 }
                ]
            }),
        ),
        "get_ai_clips" => (
            serde_json::json!({
                "projectId": "proj-abc-123"
            }),
            serde_json::json!({
                "projectId": "proj-abc-123",
                "clips": [
                    {
                        "index": 0,
                        "startSec": 0.0,
                        "endSec": 32.5,
                        "label": "Hook",
                        "segments": [
                            {
                                "orderIndex": 0,
                                "startSec": 0.0,
                                "endSec": 32.5,
                                "wordStartIdx": 0,
                                "wordEndIdx": 84
                            }
                        ]
                    }
                ]
            }),
        ),
        "patch_ai_clips" => (
            serde_json::json!({
                "projectId": "proj-abc-123",
                "mode": "overwrite",
                "clips": [
                    {
                        "label": "Hook",
                        "segments": [{ "wordStartIdx": 0, "wordEndIdx": 84 }]
                    },
                    {
                        "label": "Payoff",
                        "segments": [{ "wordStartIdx": 120, "wordEndIdx": 200 }]
                    }
                ]
            }),
            serde_json::json!({
                "projectId": "proj-abc-123",
                "clips": [
                    {
                        "index": 0,
                        "startSec": 0.0,
                        "endSec": 32.5,
                        "label": "Hook",
                        "segments": [
                            {
                                "orderIndex": 0,
                                "startSec": 0.0,
                                "endSec": 32.5,
                                "wordStartIdx": 0,
                                "wordEndIdx": 84
                            }
                        ]
                    }
                ]
            }),
        ),
        _ => (Value::Object(Default::default()), Value::Object(Default::default())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_not_schema_like(value: &Value) {
        if let Some(obj) = value.as_object() {
            assert!(!obj.contains_key("type"));
            assert!(!obj.contains_key("required"));
            assert!(!obj.contains_key("$schema"));
        }
    }

    #[test]
    fn catalog_lists_all_registered_tools_with_examples() {
        let catalog = build_mcp_tools_catalog();
        assert_eq!(catalog.tools.len(), 7);

        let tool_names: Vec<&str> = catalog.tools.iter().map(|tool| tool.name.as_str()).collect();
        for expected in [
            "list_exports",
            "get_export_details",
            "patch_export_social_metadata",
            "list_projects",
            "get_project_transcript",
            "get_ai_clips",
            "patch_ai_clips",
        ] {
            assert!(
                tool_names.contains(&expected),
                "missing tool {expected} in {tool_names:?}"
            );
        }

        for tool in &catalog.tools {
            assert!(tool.description.is_some());
            assert_not_schema_like(&tool.input_example);
            assert_not_schema_like(&tool.output_example);
        }

        let patch_ai = catalog
            .tools
            .iter()
            .find(|tool| tool.name == "patch_ai_clips")
            .expect("patch_ai_clips");
        assert_eq!(
            patch_ai.input_example.get("mode"),
            Some(&Value::String("overwrite".to_string()))
        );
        assert!(patch_ai
            .input_example
            .get("clips")
            .and_then(|v| v.as_array())
            .is_some());
    }
}
