use std::sync::Arc;

use axum::Router;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService,
    session::local::LocalSessionManager,
};
use sea_orm::DatabaseConnection;
use tokio_util::sync::CancellationToken;

use crate::mcp::server::OpenClipperMcpServer;

pub const DEFAULT_MCP_HTTP_PORT: u16 = 12742;

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

pub async fn start_mcp_http_server(
    database: Arc<DatabaseConnection>,
    port: u16,
) -> Result<McpHttpServer, String> {
    let cancel = CancellationToken::new();
    let config = StreamableHttpServerConfig::default().with_cancellation_token(cancel.clone());

    let service: StreamableHttpService<OpenClipperMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(OpenClipperMcpServer::new(database.clone())),
            Arc::new(LocalSessionManager::default()),
            config,
        );

    let router = Router::new().nest_service("/mcp", service);
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
