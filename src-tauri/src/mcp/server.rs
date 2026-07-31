use std::sync::Arc;

use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::Value;

use crate::mcp::helpers::{
    build_export_graph, format_label, format_platform, metadata_prompt_for_export,
    missing_social_fields, publish_agent_prompt, publish_platform, suggested_response_schema,
};
use crate::storage::repository::export_map_repository::ExportMapRepository;
use crate::storage::repository::export_publish_repository::ExportPublishRepository;
use crate::storage::repository::export_repository::{
    ClipperExportRecord, ClipperExportSocialPatch, ExportRepository, SocialPatchMode,
};
use crate::storage::repository::project_repository::ProjectRepository;

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
struct ListExportsParams {
    #[schemars(description = "Optional project id filter")]
    project_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExportIdParams {
    #[schemars(description = "Clipper export row id")]
    export_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct PatchExportSocialParams {
    export_id: String,
    social_title: Option<String>,
    social_short_description: Option<String>,
    social_description: Option<String>,
    social_description_timestamped: Option<String>,
    social_hashtags: Option<String>,
    #[schemars(description = "overwrite or fill_missing (default fill_missing)")]
    mode: Option<String>,
}

fn export_list_item(record: &ClipperExportRecord) -> Value {
    serde_json::json!({
        "exportId": record.id,
        "projectId": record.project_id,
        "clipIndex": record.clip_index,
        "formatId": record.format_id,
        "platform": format_platform(&record.format_id),
        "formatLabel": format_label(&record.format_id),
        "exportedAt": record.exported_at,
        "missingFields": missing_social_fields(record),
        "hasTranscript": !record.transcript_plain.trim().is_empty(),
    })
}

fn export_context(record: &ClipperExportRecord) -> Value {
    serde_json::json!({
        "exportId": record.id,
        "projectId": record.project_id,
        "clipIndex": record.clip_index,
        "formatId": record.format_id,
        "platform": format_platform(&record.format_id),
        "publishPlatform": publish_platform(&record.format_id),
        "formatLabel": format_label(&record.format_id),
        "clipStartSec": record.clip_start_sec,
        "clipEndSec": record.clip_end_sec,
        "exportedAt": record.exported_at,
        "transcriptPlain": record.transcript_plain,
        "transcriptTimestamped": record.transcript_timestamped,
        "socialTitle": record.social_title,
        "socialShortDescription": record.social_short_description,
        "socialDescription": record.social_description,
        "socialDescriptionTimestamped": record.social_description_timestamped,
        "socialHashtags": record.social_hashtags,
        "missingFields": missing_social_fields(record),
        "suggestedResponseSchema": suggested_response_schema(),
    })
}

fn patch_mode_from_str(mode: Option<String>) -> SocialPatchMode {
    match mode.as_deref() {
        Some("overwrite") => SocialPatchMode::Overwrite,
        _ => SocialPatchMode::FillMissing,
    }
}

#[tool_router]
impl OpenClipperMcpServer {
    #[tool(description = "List Open Clipper projects (id and name)")]
    async fn list_projects(&self) -> Result<String, String> {
        let summaries = ProjectRepository::list_summaries(self.database.as_ref(), Some("clipper"))
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())
    }

    #[tool(description = "List clip exports with missing metadata flags")]
    async fn list_exports(
        &self,
        Parameters(params): Parameters<ListExportsParams>,
    ) -> Result<String, String> {
        let records = ExportRepository::list_all(
            self.database.as_ref(),
            params.project_id.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
        let items: Vec<Value> = records.iter().map(export_list_item).collect();
        serde_json::to_string_pretty(&items).map_err(|e| e.to_string())
    }

    #[tool(description = "Full export graph: project hubs, export nodes, edges, publish status")]
    async fn list_export_graph(
        &self,
        Parameters(params): Parameters<ListExportsParams>,
    ) -> Result<String, String> {
        let items = ExportMapRepository::list_all(self.database.as_ref(), params.project_id.as_deref())
            .await
            .map_err(|e| e.to_string())?;
        let item_values: Vec<Value> = items
            .iter()
            .map(|item| serde_json::to_value(item).unwrap_or(Value::Null))
            .collect();
        let graph = build_export_graph(&item_values);
        serde_json::to_string_pretty(&graph).map_err(|e| e.to_string())
    }

    #[tool(description = "Export node detail: metadata gaps, publish status, suggested actions")]
    async fn get_export_node(
        &self,
        Parameters(params): Parameters<ExportIdParams>,
    ) -> Result<String, String> {
        let record = ExportRepository::get_by_id(self.database.as_ref(), &params.export_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Export not found: {}", params.export_id))?;

        let publish_platform = publish_platform(&record.format_id);
        let publishes = ExportPublishRepository::list_by_export_id(
            self.database.as_ref(),
            &params.export_id,
        )
        .await
        .map_err(|e| e.to_string())?;

        let latest_publish = publishes
            .iter()
            .find(|row| row.platform == publish_platform)
            .or_else(|| publishes.first());

        let mut node = export_context(&record);
        if let Some(map) = node.as_object_mut() {
            map.insert(
                "publishStatus".to_string(),
                serde_json::to_value(latest_publish).unwrap_or(Value::Null),
            );
            map.insert(
                "isPublished".to_string(),
                Value::Bool(
                    latest_publish
                        .map(|row| row.status == "succeeded")
                        .unwrap_or(false),
                ),
            );
            map.insert(
                "suggestedNextSteps".to_string(),
                Value::Array(if missing_social_fields(&record).is_empty() {
                    if latest_publish.map(|r| r.status == "succeeded").unwrap_or(false) {
                        vec![Value::String(
                            "Already published — open watch URL or pick another export.".into(),
                        )]
                    } else {
                        vec![Value::String(
                            "Metadata complete — user can publish from Publish map or session exports."
                                .into(),
                        )]
                    }
                } else {
                    vec![
                        Value::String("Call generate_export_metadata_prompt".into()),
                        Value::String("patch_export_social_metadata with fill_missing".into()),
                    ]
                }),
            );
        }

        serde_json::to_string_pretty(&node).map_err(|e| e.to_string())
    }

    #[tool(description = "List publish attempts for an export (all platforms)")]
    async fn list_publish_status(
        &self,
        Parameters(params): Parameters<ExportIdParams>,
    ) -> Result<String, String> {
        let publishes = ExportPublishRepository::list_by_export_id(
            self.database.as_ref(),
            &params.export_id,
        )
        .await
        .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&publishes).map_err(|e| e.to_string())
    }

    #[tool(
        description = "Workflow prompt for agent: graph overview, metadata gaps, publish order"
    )]
    async fn generate_publish_agent_prompt(
        &self,
        Parameters(params): Parameters<ListExportsParams>,
    ) -> Result<String, String> {
        let items = ExportMapRepository::list_all(self.database.as_ref(), params.project_id.as_deref())
            .await
            .map_err(|e| e.to_string())?;
        let summary = serde_json::json!({
            "exports": items.iter().map(|item| serde_json::json!({
                "exportId": item.id,
                "projectName": item.project_name,
                "formatLabel": item.format_label,
                "platform": item.platform,
                "isPublished": item.is_published,
                "missingFields": item.missing_fields,
            })).collect::<Vec<_>>(),
            "stats": {
                "total": items.len(),
                "published": items.iter().filter(|i| i.is_published).count(),
                "needsMetadata": items.iter().filter(|i| !i.missing_fields.is_empty()).count(),
            }
        });
        Ok(publish_agent_prompt(&summary))
    }

    #[tool(description = "Full export context for LLM metadata generation")]
    async fn get_export_context(
        &self,
        Parameters(params): Parameters<ExportIdParams>,
    ) -> Result<String, String> {
        let record = ExportRepository::get_by_id(self.database.as_ref(), &params.export_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Export not found: {}", params.export_id))?;

        if record.transcript_plain.trim().is_empty() {
            return Err(
                "No transcript saved for this export. Re-export the clip in Open Clipper first."
                    .to_string(),
            );
        }

        serde_json::to_string_pretty(&export_context(&record)).map_err(|e| e.to_string())
    }

    #[tool(
        description = "Returns a ready-made prompt and JSON schema for generating export metadata"
    )]
    async fn generate_export_metadata_prompt(
        &self,
        Parameters(params): Parameters<ExportIdParams>,
    ) -> Result<String, String> {
        let record = ExportRepository::get_by_id(self.database.as_ref(), &params.export_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Export not found: {}", params.export_id))?;

        Ok(metadata_prompt_for_export(&record))
    }

    #[tool(description = "Patch social metadata fields on an export row")]
    async fn patch_export_social_metadata(
        &self,
        Parameters(params): Parameters<PatchExportSocialParams>,
    ) -> Result<String, String> {
        let patch = ClipperExportSocialPatch {
            social_title: params.social_title,
            social_short_description: params.social_short_description,
            social_description: params.social_description,
            social_description_timestamped: params.social_description_timestamped,
            social_hashtags: params.social_hashtags,
        };
        let mode = patch_mode_from_str(params.mode);
        let updated = ExportRepository::patch_social_metadata(
            self.database.as_ref(),
            &params.export_id,
            patch,
            mode,
        )
        .await
        .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for OpenClipperMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "Open Clipper export metadata and publish MCP server. \
                 Use list_export_graph to navigate exports, fill metadata via patch_export_social_metadata, \
                 and generate_publish_agent_prompt for publish workflow guidance.",
            )
    }
}

pub async fn run_stdio_server(database: Arc<DatabaseConnection>) -> anyhow::Result<()> {
    let server = OpenClipperMcpServer::new(database);
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}
