use std::sync::Arc;
use std::time::Duration;

use axum::{
    Json, Router,
    http::StatusCode,
    routing::post,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager,
    StreamableHttpServerConfig, StreamableHttpService,
};
use sea_orm::DatabaseConnection;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::clipper::exports_notify::{
    ClipperExportsChangedEvent, enqueue_exports_changed,
};
use crate::mcp::server::OpenClipperMcpServer;

pub const DEFAULT_MCP_HTTP_PORT: u16 = 12742;

const MCP_SESSION_KEEP_ALIVE_SECS: u64 = 3600;

#[derive(Clone)]
pub struct McpHttpServer {
    pub base_url: String,
    cancel: CancellationToken,
}

impl McpHttpServer {
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

fn allowed_hosts_for_port(port: u16) -> Vec<String> {
    vec![
        "127.0.0.1".to_string(),
        format!("127.0.0.1:{port}"),
        "localhost".to_string(),
        format!("localhost:{port}"),
        "::1".to_string(),
    ]
}

async fn handle_exports_changed(
    Json(detail): Json<ClipperExportsChangedEvent>,
) -> StatusCode {
    enqueue_exports_changed(detail);
    StatusCode::NO_CONTENT
}

pub async fn start_mcp_http_server(
    app: AppHandle,
    database: Arc<DatabaseConnection>,
    port: u16,
) -> Result<McpHttpServer, String> {
    let app_for_mcp = app.clone();
    crate::clipper::exports_notify::spawn_exports_notify_listener(app);

    let cancel = CancellationToken::new();
    let config = StreamableHttpServerConfig::default()
        .with_cancellation_token(cancel.clone())
        .with_json_response(true)
        .with_allowed_hosts(allowed_hosts_for_port(port));

    let mut session_manager = LocalSessionManager::default();
    session_manager.session_config.keep_alive = Some(Duration::from_secs(MCP_SESSION_KEEP_ALIVE_SECS));

    let app_for_mcp = app_for_mcp.clone();
    let service: StreamableHttpService<OpenClipperMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(OpenClipperMcpServer::with_app(database.clone(), app_for_mcp.clone())),
            Arc::new(session_manager),
            config,
        );

    let router = Router::new()
        .route(
            "/mcp/internal/exports-changed",
            post(handle_exports_changed),
        )
        .nest_service("/mcp", service);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|error| format!("MCP HTTP bind failed on {addr}: {error}"))?;

    let base_url = format!("http://{addr}/mcp");
    let shutdown = cancel.clone();

    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown.cancelled_owned().await;
            })
            .await
        {
            log::error!("Open Clipper MCP HTTP server stopped: {error}");
        }
    });

    log::info!("Open Clipper MCP HTTP listening on {base_url}");

    Ok(McpHttpServer {
        base_url,
        cancel,
    })
}

pub fn resolve_mcp_http_port() -> u16 {
    std::env::var("OPEN_CLIPPER_MCP_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_MCP_HTTP_PORT)
}
