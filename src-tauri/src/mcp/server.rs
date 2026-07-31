use std::sync::Arc;

use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::mcp::helpers::format_platform;
use crate::mcp::list_exports::{list_exports_response, ListExportsParams};
use crate::storage::repository::export_map_repository::ExportMapRepository;
use crate::storage::repository::export_repository::{
    ClipperExportRecord, ClipperExportSocialPatch, ExportRepository, SocialPatchMode,
};

#[derive(Debug, Clone)]
pub struct OpenClipperMcpServer {
    database: Arc<DatabaseConnection>,
    tool_router: ToolRouter<Self>,
}

impl OpenClipperMcpServer {
    pub fn new(database: Arc<DatabaseConnection>) -> Self {
        Self {
            database,
            tool_router: Self::tool_router(),
        }
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct GetExportDetailsParams {
    export_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum McpPatchMode {
    /// Replace existing title/description/hashtags with provided values.
    Overwrite,
    /// Only write fields that are currently empty (default).
    #[serde(alias = "fillMissing")]
    FillMissing,
}

impl Default for McpPatchMode {
    fn default() -> Self {
        Self::FillMissing
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct PatchExportSocialParams {
    export_id: String,
    title: Option<String>,
    description: Option<String>,
    hashtags: Option<String>,
    #[serde(default)]
    mode: McpPatchMode,
}

#[derive(Debug, schemars::JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpExportDetails {
    export_id: String,
    project_id: String,
    platform: String,
    exported_at: String,
    transcript_timestamped: Option<String>,
    title: Option<String>,
    description: Option<String>,
    hashtags: Option<String>,
}

#[derive(Debug, schemars::JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpPatchResult {
    export_id: String,
    title: String,
    description: String,
    hashtags: String,
}

fn non_empty_string(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn export_details(record: &ClipperExportRecord) -> McpExportDetails {
    McpExportDetails {
        export_id: record.id.clone(),
        project_id: record.project_id.clone(),
        platform: format_platform(&record.format_id).to_string(),
        exported_at: record.exported_at.clone(),
        transcript_timestamped: non_empty_string(record.transcript_timestamped.clone()),
        title: non_empty_string(record.social_title.clone()),
        description: non_empty_string(record.social_description.clone()),
        hashtags: non_empty_string(record.social_hashtags.clone()),
    }
}

fn patch_result(record: &ClipperExportRecord) -> McpPatchResult {
    McpPatchResult {
        export_id: record.id.clone(),
        title: record.social_title.clone(),
        description: record.social_description.clone(),
        hashtags: record.social_hashtags.clone(),
    }
}

fn patch_mode_from_mcp(mode: McpPatchMode) -> SocialPatchMode {
    match mode {
        McpPatchMode::Overwrite => SocialPatchMode::Overwrite,
        McpPatchMode::FillMissing => SocialPatchMode::FillMissing,
    }
}

#[tool_router]
impl OpenClipperMcpServer {
    #[tool(
        description = "List clip exports with status, pagination (skip/rows), and filters (status, hasTranscript). Defaults: incomplete, hasTranscript=true, sort=newest"
    )]
    async fn list_exports(
        &self,
        Parameters(params): Parameters<ListExportsParams>,
    ) -> Result<String, String> {
        let items = ExportMapRepository::list_all(
            self.database.as_ref(),
            params.project_id.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
        let response = list_exports_response(items, &params);
        serde_json::to_string_pretty(&response).map_err(|e| e.to_string())
    }

    #[tool(description = "Get export details: transcript with timestamps and current title/description/hashtags")]
    async fn get_export_details(
        &self,
        Parameters(params): Parameters<GetExportDetailsParams>,
    ) -> Result<String, String> {
        let record = ExportRepository::get_by_id(self.database.as_ref(), &params.export_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Export not found: {}", params.export_id))?;
        serde_json::to_string_pretty(&export_details(&record)).map_err(|e| e.to_string())
    }

    #[tool(
        description = "Patch title, description, and hashtags. mode: overwrite (replace all) or fill_missing (only empty fields, default)"
    )]
    async fn patch_export_social_metadata(
        &self,
        Parameters(params): Parameters<PatchExportSocialParams>,
    ) -> Result<String, String> {
        let patch = ClipperExportSocialPatch {
            social_title: params.title,
            social_short_description: None,
            social_description: params.description,
            social_description_timestamped: None,
            social_hashtags: params.hashtags,
        };
        let mode = patch_mode_from_mcp(params.mode);
        let updated = ExportRepository::patch_social_metadata(
            self.database.as_ref(),
            &params.export_id,
            patch,
            mode,
        )
        .await
        .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&patch_result(&updated)).map_err(|e| e.to_string())
    }
}

pub fn list_registered_mcp_tools() -> Vec<rmcp::model::Tool> {
    OpenClipperMcpServer::tool_router().list_all()
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for OpenClipperMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "open-clipper",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Open Clipper export metadata MCP server. Workflow: 1) list_exports — find exports with missing metadata; 2) get_export_details — read transcript and current title/description/hashtags; 3) patch_export_social_metadata — write title, description, hashtags (mode fill_missing by default). In Cursor, use stdio transport (not HTTP URL) so tools appear without OAuth.",
            )
    }
}

pub async fn run_stdio_server(database: Arc<DatabaseConnection>) -> anyhow::Result<()> {
    let server = OpenClipperMcpServer::new(database);
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn sample_record() -> ClipperExportRecord {
        ClipperExportRecord {
            id: "export-1".to_string(),
            project_id: "project-1".to_string(),
            clip_index: 0,
            format_id: "youtube".to_string(),
            file_name: "clip.mp4".to_string(),
            relative_path: "exports/clip.mp4".to_string(),
            width: 1920,
            height: 1080,
            file_size: 1024,
            clip_start_sec: Some(0.0),
            clip_end_sec: Some(60.0),
            exported_at: "2026-01-01T00:00:00Z".to_string(),
            transcript_plain: "hello world".to_string(),
            transcript_timestamped: "[0:00] hello\n[0:02] world".to_string(),
            social_title: "My Title".to_string(),
            social_short_description: String::new(),
            social_description: "My description".to_string(),
            social_description_timestamped: String::new(),
            social_hashtags: String::new(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn export_details_maps_short_metadata_names() {
        let details = export_details(&sample_record());
        assert_eq!(details.export_id, "export-1");
        assert_eq!(details.title.as_deref(), Some("My Title"));
        assert_eq!(details.description.as_deref(), Some("My description"));
        assert_eq!(details.hashtags, None);
        assert_eq!(
            details.transcript_timestamped.as_deref(),
            Some("[0:00] hello\n[0:02] world")
        );
        let json = serde_json::to_value(&details).expect("serialize export details");
        let obj = json.as_object().expect("object");
        assert!(!obj.contains_key("clipIndex"));
        assert!(!obj.contains_key("missingFields"));
        assert!(!obj.contains_key("hasTranscript"));
        assert_eq!(obj.get("hashtags"), Some(&Value::Null));
    }

    #[test]
    fn patch_mode_deserializes_overwrite_and_fill_missing() {
        let overwrite: McpPatchMode = serde_json::from_str("\"overwrite\"").unwrap();
        let fill_missing: McpPatchMode = serde_json::from_str("\"fill_missing\"").unwrap();
        assert!(matches!(overwrite, McpPatchMode::Overwrite));
        assert!(matches!(fill_missing, McpPatchMode::FillMissing));

        let defaults: PatchExportSocialParams = serde_json::from_str(
            r#"{"exportId":"exp-1","title":"t"}"#,
        )
        .unwrap();
        assert!(matches!(defaults.mode, McpPatchMode::FillMissing));
    }

    #[test]
    fn patch_mode_maps_overwrite_and_fill_missing() {
        assert_eq!(
            patch_mode_from_mcp(McpPatchMode::Overwrite),
            SocialPatchMode::Overwrite
        );
        assert_eq!(
            patch_mode_from_mcp(McpPatchMode::FillMissing),
            SocialPatchMode::FillMissing
        );
    }

    #[test]
    fn registered_tools_have_no_output_schema() {
        let tools = list_registered_mcp_tools();
        assert_eq!(tools.len(), 3);
        for tool in tools {
            assert!(
                tool.output_schema.is_none(),
                "tool {} should not declare output_schema (Cursor rejects it)",
                tool.name
            );
        }
    }

    #[test]
    fn patch_result_excludes_transcript_and_file_fields() {
        let result = patch_result(&sample_record());
        let json = serde_json::to_value(&result).expect("serialize patch result");
        let obj = json.as_object().expect("object");
        assert!(obj.contains_key("exportId"));
        assert!(obj.contains_key("title"));
        assert!(obj.contains_key("description"));
        assert!(obj.contains_key("hashtags"));
        assert!(!obj.contains_key("missingFields"));
        assert!(!obj.contains_key("transcriptPlain"));
        assert!(!obj.contains_key("transcriptTimestamped"));
        assert!(!obj.contains_key("fileName"));
        assert!(!obj.contains_key("relativePath"));
    }
}
