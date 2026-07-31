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

const MCP_INSTRUCTIONS: &str = "Open Clipper export metadata MCP server. Use list_exports to browse clip exports, then patch_export_social_metadata to fill social fields. In Cursor, prefer stdio transport (not HTTP URL) so tools appear without OAuth.";

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
        assert_eq!(catalog.tools.len(), 3);

        let tool_names: Vec<&str> = catalog.tools.iter().map(|tool| tool.name.as_str()).collect();
        assert!(tool_names.contains(&"list_exports"));
        assert!(tool_names.contains(&"get_export_details"));
        assert!(tool_names.contains(&"patch_export_social_metadata"));

        for tool in &catalog.tools {
            assert!(tool.description.is_some());
            assert_not_schema_like(&tool.input_example);
            assert_not_schema_like(&tool.output_example);
        }

        let list_exports = catalog
            .tools
            .iter()
            .find(|tool| tool.name == "list_exports")
            .expect("list_exports tool should be registered");
        assert!(list_exports.input_example.get("projectId").is_some());
        assert_eq!(
            list_exports.input_example.get("status"),
            Some(&Value::String("incomplete".to_string()))
        );
        let list_output = list_exports
            .output_example
            .as_object()
            .expect("list_exports output example");
        assert!(list_output.get("items").and_then(|v| v.as_array()).is_some());
        assert!(list_output.contains_key("total"));
        assert!(list_output.contains_key("skip"));
        assert!(list_output.contains_key("rows"));

        let get_export_details = catalog
            .tools
            .iter()
            .find(|tool| tool.name == "get_export_details")
            .expect("get_export_details tool should be registered");
        assert_eq!(
            get_export_details.input_example.get("exportId"),
            Some(&Value::String("exp-001".to_string()))
        );
        assert!(get_export_details
            .output_example
            .get("transcriptTimestamped")
            .is_some());
        assert!(!get_export_details
            .output_example
            .as_object()
            .expect("get output example")
            .contains_key("clipIndex"));
        assert!(!get_export_details
            .output_example
            .as_object()
            .expect("get output example")
            .contains_key("hasTranscript"));

        let patch_export = catalog
            .tools
            .iter()
            .find(|tool| tool.name == "patch_export_social_metadata")
            .expect("patch_export_social_metadata tool should be registered");
        let patch_input = patch_export
            .input_example
            .as_object()
            .expect("patch input example");
        assert!(patch_input.contains_key("exportId"));
        assert!(patch_input.contains_key("title"));
        assert!(patch_input.contains_key("description"));
        assert!(patch_input.contains_key("hashtags"));
        assert!(!patch_input.contains_key("socialTitle"));
        assert_eq!(
            patch_input.get("mode"),
            Some(&Value::String("fill_missing".to_string()))
        );

        let patch_output = patch_export
            .output_example
            .as_object()
            .expect("patch output example");
        assert!(patch_output.contains_key("title"));
        assert!(!patch_output.contains_key("missingFields"));
        assert!(!patch_output.contains_key("transcriptPlain"));
    }
}
