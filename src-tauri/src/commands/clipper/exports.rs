use std::fs;

use tauri::{AppHandle, State};

use crate::clipper::data::clipper_export_file_path;
use crate::clipper::exports_notify::{
    ClipperExportsChangedEvent, EXPORTS_CHANGED_REASON_DELETE, EXPORTS_CHANGED_REASON_PATCH_SOCIAL,
    EXPORTS_CHANGED_REASON_PUBLISH, EXPORTS_CHANGED_REASON_UPSERT, emit_exports_changed,
};
use crate::storage::database::LocalDb;
use crate::storage::export_cleanup;
use crate::storage::repository::export_map_repository::{
    ClipperExportMapItem, ExportMapRepository,
};
use crate::storage::repository::export_publish_repository::{
    ClipperExportPublishRecord, ClipperExportPublishUpsertInput, ExportPublishRepository,
};
use crate::storage::repository::export_repository::{
    ClipperExportRecord, ClipperExportSocialPatch, ClipperExportUpsertInput, ExportRepository,
    SocialPatchMode,
};

#[tauri::command]
pub async fn clipper_export_upsert(
    app: AppHandle,
    db: State<'_, LocalDb>,
    project_id: String,
    export: ClipperExportUpsertInput,
) -> Result<ClipperExportRecord, String> {
    let export_id = export.id.clone();
    let record = ExportRepository::upsert(&db.database, &project_id, export)
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?;
    emit_exports_changed(
        &app,
        ClipperExportsChangedEvent::new(
            Some(project_id),
            Some(export_id),
            EXPORTS_CHANGED_REASON_UPSERT,
        ),
    );
    Ok(record)
}

#[tauri::command]
pub async fn clipper_exports_list(
    db: State<'_, LocalDb>,
    project_id: String,
) -> Result<Vec<ClipperExportRecord>, String> {
    ExportRepository::list_by_project(&db.database, &project_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clipper_export_get(
    db: State<'_, LocalDb>,
    export_id: String,
) -> Result<ClipperExportRecord, String> {
    ExportRepository::get_by_id(&db.database, &export_id)
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?
        .ok_or_else(|| format!("Export not found: {export_id}"))
}

#[tauri::command]
pub async fn clipper_exports_list_all(
    db: State<'_, LocalDb>,
    project_id: Option<String>,
) -> Result<Vec<ClipperExportMapItem>, String> {
    ExportMapRepository::list_all(&db.database, project_id.as_deref())
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())
}

#[tauri::command]
pub async fn clipper_export_publish_upsert(
    app: AppHandle,
    db: State<'_, LocalDb>,
    publish: ClipperExportPublishUpsertInput,
) -> Result<ClipperExportPublishRecord, String> {
    let export_id = publish.export_id.clone();
    let record = ExportPublishRepository::upsert(&db.database, publish)
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?;
    emit_exports_changed(
        &app,
        ClipperExportsChangedEvent::new(None, Some(export_id), EXPORTS_CHANGED_REASON_PUBLISH),
    );
    Ok(record)
}

#[tauri::command]
pub async fn clipper_export_publishes_list(
    db: State<'_, LocalDb>,
    export_id: String,
) -> Result<Vec<ClipperExportPublishRecord>, String> {
    ExportPublishRepository::list_by_export_id(&db.database, &export_id)
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())
}

#[tauri::command]
pub async fn clipper_export_patch_social(
    app: AppHandle,
    db: State<'_, LocalDb>,
    export_id: String,
    patch: ClipperExportSocialPatch,
    mode: SocialPatchMode,
) -> Result<ClipperExportRecord, String> {
    let record = ExportRepository::patch_social_metadata(&db.database, &export_id, patch, mode)
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?;
    emit_exports_changed(
        &app,
        ClipperExportsChangedEvent::new(
            Some(record.project_id.clone()),
            Some(record.id.clone()),
            EXPORTS_CHANGED_REASON_PATCH_SOCIAL,
        ),
    );
    Ok(record)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExportsPurgeResult {
    pub removed_missing_on_disk: usize,
    pub removed_orphaned_projects: u64,
}

#[tauri::command]
pub async fn clipper_export_delete(
    app: AppHandle,
    db: State<'_, LocalDb>,
    export_id: String,
) -> Result<(), String> {
    let export = ExportRepository::get_by_id(&db.database, &export_id)
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?
        .ok_or_else(|| format!("Export not found: {export_id}"))?;

    let project_id = export.project_id.clone();
    let deleted_export_id = export_id.clone();
    let path = clipper_export_file_path(&app, &export.project_id, &export.file_name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    ExportPublishRepository::delete_by_export_ids(&db.database, &[export_id.clone()])
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?;
    ExportRepository::delete_by_ids(&db.database, &[export_id])
        .await
        .map_err(|e: crate::infra::error::DbError| e.to_string())?;

    emit_exports_changed(
        &app,
        ClipperExportsChangedEvent::new(
            Some(project_id),
            Some(deleted_export_id),
            EXPORTS_CHANGED_REASON_DELETE,
        ),
    );

    Ok(())
}

#[tauri::command]
pub async fn clipper_exports_purge_missing(
    app: tauri::AppHandle,
    db: State<'_, LocalDb>,
    project_id: Option<String>,
) -> Result<ClipperExportsPurgeResult, String> {
    let removed_missing_on_disk = export_cleanup::purge_missing_on_disk(
        &app,
        &db.database,
        project_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())?;

    let removed_orphaned_projects =
        export_cleanup::delete_orphaned_project_exports(&db.database)
            .await
            .map_err(|error| error.to_string())?;

    Ok(ClipperExportsPurgeResult {
        removed_missing_on_disk,
        removed_orphaned_projects,
    })
}

#[tauri::command]
pub fn get_open_clipper_mcp_http_url(mcp: State<'_, crate::mcp::McpHttpServer>) -> String {
    mcp.base_url.clone()
}

#[tauri::command]
pub fn get_open_clipper_mcp_path() -> Result<String, String> {
    resolve_open_clipper_mcp_binary()
        .map(|path| path.to_string_lossy().into_owned())
}

fn resolve_open_clipper_mcp_binary() -> Result<std::path::PathBuf, String> {
    let mcp_name = if cfg!(windows) {
        "open-clipper-mcp.exe"
    } else {
        "open-clipper-mcp"
    };

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let beside_app = dir.join(mcp_name);
            if beside_app.exists() {
                return Ok(beside_app);
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        let bin_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
        if let Ok(entries) = std::fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let file_name = file_name.to_string_lossy();
                if file_name.starts_with("open-clipper-mcp") {
                    return Ok(entry.path());
                }
            }
        }
    }

    Err(format!(
        "{mcp_name} not found beside the app or in src-tauri/bin. Build it with: cargo build --bin open-clipper-mcp"
    ))
}

#[tauri::command]
pub fn get_open_clipper_mcp_tools_catalog() -> Result<crate::mcp::McpToolsCatalog, String> {
    Ok(crate::mcp::build_mcp_tools_catalog())
}
