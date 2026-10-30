//! The long-running `zogsshd serve` process.

use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;

use crate::config;

pub mod debounce;
pub mod http;
pub mod watch;

pub struct ServeCtx {
    pub home: PathBuf,
    pub herdr_socket: PathBuf,
    pub config_path: PathBuf,
    pub push_url: String,
    pub debounce: Duration,
    /// `None` = take the port from the config.
    pub pair_port: Option<u16>,
    pub host_key_paths: Vec<PathBuf>,
    pub exe: PathBuf,
}

pub async fn run(ctx: ServeCtx, shutdown: impl Future<Output = ()>) -> Result<()> {
    let config = config::load(&ctx.config_path)?;
    let port = ctx.pair_port.unwrap_or(config.pair_port);
    // The phone reaches the pairing endpoint over the LAN, so listen on every interface.
    // Without the port the watcher still runs; only pairing is unavailable.
    let pairing = async {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                if let Err(e) = http::serve(listener, http::State::new(&ctx)).await {
                    eprintln!("zogsshd serve: pairing endpoint stopped: {e}");
                }
            }
            Err(e) => eprintln!("zogsshd serve: cannot listen on port {port} for pairing: {e}"),
        }
        std::future::pending::<()>().await
    };
    eprintln!("zogsshd serve: started");
    tokio::select! {
        _ = watch::watch(&ctx) => {}
        _ = pairing => {}
        _ = shutdown => {}
    }
    Ok(())
}
