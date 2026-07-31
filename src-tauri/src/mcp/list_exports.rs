use serde::{Deserialize, Serialize};

use crate::storage::repository::export_map_repository::ClipperExportMapItem;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpExportStatus {
    Incomplete,
    Ready,
    Published,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum McpExportStatusFilter {
    #[default]
    Incomplete,
    Ready,
    Published,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum McpExportSort {
    #[default]
    Newest,
    Oldest,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListExportsParams {
    #[schemars(description = "Optional project id filter")]
    pub project_id: Option<String>,
    #[serde(default)]
    #[schemars(description = "Filter by status: incomplete (default), ready, published, or all")]
    pub status: McpExportStatusFilter,
    #[serde(default = "default_has_transcript")]
    #[schemars(description = "Filter by transcript presence (default true)")]
    pub has_transcript: bool,
    #[serde(default)]
    #[schemars(description = "Number of rows to skip (default 0)")]
    pub skip: u32,
    #[serde(default = "default_rows")]
    #[schemars(description = "Page size (default 20)")]
    pub rows: u32,
    #[serde(default)]
    #[schemars(description = "Sort order: newest (default) or oldest")]
    pub sort: McpExportSort,
}

fn default_has_transcript() -> bool {
    true
}

fn default_rows() -> u32 {
    20
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpExportListItem {
    pub export_id: String,
    pub project_id: String,
    pub project_name: String,
    pub clip_index: i32,
    pub platform: String,
    pub exported_at: String,
    pub status: McpExportStatus,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpExportListResponse {
    pub items: Vec<McpExportListItem>,
    pub total: usize,
    pub skip: u32,
    pub rows: u32,
}

pub fn export_status(item: &ClipperExportMapItem) -> McpExportStatus {
    if item.is_published {
        McpExportStatus::Published
    } else if item.missing_fields.is_empty() {
        McpExportStatus::Ready
    } else {
        McpExportStatus::Incomplete
    }
}

fn item_has_transcript(item: &ClipperExportMapItem) -> bool {
    !item.transcript_timestamped.trim().is_empty()
}

fn matches_status_filter(status: McpExportStatus, filter: McpExportStatusFilter) -> bool {
    match filter {
        McpExportStatusFilter::All => true,
        McpExportStatusFilter::Incomplete => status == McpExportStatus::Incomplete,
        McpExportStatusFilter::Ready => status == McpExportStatus::Ready,
        McpExportStatusFilter::Published => status == McpExportStatus::Published,
    }
}

fn to_list_item(item: &ClipperExportMapItem) -> McpExportListItem {
    McpExportListItem {
        export_id: item.id.clone(),
        project_id: item.project_id.clone(),
        project_name: item.project_name.clone(),
        clip_index: item.clip_index,
        platform: item.platform.clone(),
        exported_at: item.exported_at.clone(),
        status: export_status(item),
    }
}

pub fn list_exports_response(
    items: Vec<ClipperExportMapItem>,
    params: &ListExportsParams,
) -> McpExportListResponse {
    let mut filtered: Vec<ClipperExportMapItem> = items
        .into_iter()
        .filter(|item| {
            let status = export_status(item);
            matches_status_filter(status, params.status)
                && item_has_transcript(item) == params.has_transcript
        })
        .collect();

    match params.sort {
        McpExportSort::Newest => {
            filtered.sort_by(|left, right| right.exported_at.cmp(&left.exported_at));
        }
        McpExportSort::Oldest => {
            filtered.sort_by(|left, right| left.exported_at.cmp(&right.exported_at));
        }
    }

    let total = filtered.len();
    let skip = params.skip as usize;
    let rows = params.rows as usize;
    let page = filtered
        .into_iter()
        .skip(skip)
        .take(rows)
        .map(|item| to_list_item(&item))
        .collect();

    McpExportListResponse {
        items: page,
        total,
        skip: params.skip,
        rows: params.rows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_item(
        id: &str,
        exported_at: &str,
        title: &str,
        is_published: bool,
        transcript: &str,
    ) -> ClipperExportMapItem {
        let missing_fields = [
            title.is_empty().then_some("title"),
            Some("description"),
            Some("hashtags"),
        ]
        .into_iter()
        .flatten()
        .map(str::to_string)
        .collect();

        ClipperExportMapItem {
            id: id.to_string(),
            project_id: "proj-1".to_string(),
            project_name: "Project".to_string(),
            clipper_owner_id: None,
            clipper_owner_name: None,
            clip_index: 0,
            format_id: "youtube".to_string(),
            platform: "youtube".to_string(),
            format_label: "YouTube".to_string(),
            file_name: "clip.mp4".to_string(),
            relative_path: "clip.mp4".to_string(),
            width: 1920,
            height: 1080,
            file_size: 1,
            clip_start_sec: None,
            clip_end_sec: None,
            exported_at: exported_at.to_string(),
            transcript_plain: transcript.to_string(),
            transcript_timestamped: transcript.to_string(),
            social_title: title.to_string(),
            social_short_description: String::new(),
            social_description: String::new(),
            social_description_timestamped: String::new(),
            social_hashtags: String::new(),
            created_at: exported_at.to_string(),
            updated_at: exported_at.to_string(),
            missing_fields,
            has_transcript: !transcript.is_empty(),
            publish_status: None,
            is_published,
        }
    }

    #[test]
    fn export_status_reflects_publish_and_metadata_state() {
        let incomplete = sample_item("a", "2026-01-01T00:00:00Z", "", false, "[0:00] hi");
        assert_eq!(export_status(&incomplete), McpExportStatus::Incomplete);

        let ready = sample_item("b", "2026-01-02T00:00:00Z", "title", false, "[0:00] hi");
        let mut ready = ready;
        ready.missing_fields.clear();
        assert_eq!(export_status(&ready), McpExportStatus::Ready);

        let published = sample_item("c", "2026-01-03T00:00:00Z", "title", true, "[0:00] hi");
        let mut published = published;
        published.missing_fields.clear();
        assert_eq!(export_status(&published), McpExportStatus::Published);
    }

    #[test]
    fn list_exports_defaults_filter_incomplete_with_transcript_and_newest_sort() {
        let items = vec![
            sample_item("old", "2026-01-01T00:00:00Z", "", false, "[0:00] a"),
            sample_item("new", "2026-01-03T00:00:00Z", "", false, "[0:00] b"),
            sample_item("no-transcript", "2026-01-04T00:00:00Z", "", false, ""),
            sample_item("ready", "2026-01-05T00:00:00Z", "title", false, "[0:00] c"),
        ];
        let mut ready = items[3].clone();
        ready.missing_fields.clear();

        let items = vec![
            items[0].clone(),
            items[1].clone(),
            items[2].clone(),
            ready,
        ];

        let params = ListExportsParams {
            project_id: None,
            status: McpExportStatusFilter::default(),
            has_transcript: default_has_transcript(),
            skip: 0,
            rows: default_rows(),
            sort: McpExportSort::default(),
        };

        let response = list_exports_response(items, &params);
        assert_eq!(response.total, 2);
        assert_eq!(response.items.len(), 2);
        assert_eq!(response.items[0].export_id, "new");
        assert_eq!(response.items[1].export_id, "old");
        assert!(response
            .items
            .iter()
            .all(|item| item.status == McpExportStatus::Incomplete));
    }

    #[test]
    fn list_exports_supports_pagination_and_status_filter() {
        let items = vec![
            sample_item("one", "2026-01-01T00:00:00Z", "", false, "[0:00] a"),
            sample_item("two", "2026-01-02T00:00:00Z", "", false, "[0:00] b"),
            sample_item("three", "2026-01-03T00:00:00Z", "", false, "[0:00] c"),
        ];

        let params = ListExportsParams {
            project_id: None,
            status: McpExportStatusFilter::Incomplete,
            has_transcript: true,
            skip: 1,
            rows: 1,
            sort: McpExportSort::Newest,
        };

        let response = list_exports_response(items, &params);
        assert_eq!(response.total, 3);
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].export_id, "two");
    }
}
