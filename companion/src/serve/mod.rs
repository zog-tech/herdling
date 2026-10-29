//! The long-running `zogsshd serve` process.

use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;

use crate::config;

pub mod debounce;
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
    let _config = config::load(&ctx.config_path)?;
    eprintln!("zogsshd serve: started");
    tokio::select! {
        _ = watch::watch(&ctx) => {}
        _ = shutdown => {}
    }
    Ok(())
}
