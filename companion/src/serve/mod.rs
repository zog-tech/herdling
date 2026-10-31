//! The long-running `herdlingd serve` process.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;

use crate::config;

pub mod bonjour;
pub mod debounce;
pub mod desk;
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

/// Takes the exclusive `serve.lock` next to the config, so a second `serve` (for example a
/// manual one next to the launchd unit) exits instead of sending every push twice.
/// The lock lasts as long as the returned file.
pub fn take_serve_lock(config_path: &Path) -> Result<std::fs::File> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let dir = config_path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let file = std::fs::OpenOptions::new().create(true).truncate(false).write(true).mode(0o600).open(dir.join("serve.lock"))?;
    if !fs4::fs_std::FileExt::try_lock_exclusive(&file)? {
        anyhow::bail!("another herdlingd serve is running (lock {} is held)", dir.join("serve.lock").display());
    }
    Ok(file)
}

pub async fn run(ctx: ServeCtx, shutdown: impl Future<Output = ()>) -> Result<()> {
    let _lock = take_serve_lock(&ctx.config_path)?;
    let config = config::load(&ctx.config_path)?;
    let fingerprint = crate::pair::host_fingerprint(&ctx.host_key_paths);
    if fingerprint.is_none() {
        eprintln!("herdlingd serve: warning: no host key found, so pairing sends no host key fingerprint and the phone trusts the first key it sees");
    }
    let port = ctx.pair_port.unwrap_or(config.pair_port);
    // The phone reaches the pairing endpoint over the LAN, so listen on every interface.
    // Without the port the watcher still runs; only pairing is unavailable.
    let pairing = async {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                if let Err(e) = http::serve(listener, http::State::new(&ctx)).await {
                    eprintln!("herdlingd serve: pairing endpoint stopped: {e}");
                }
            }
            Err(e) => eprintln!("herdlingd serve: cannot listen on port {port} for pairing: {e}"),
        }
        std::future::pending::<()>().await
    };
    // An advert failure only costs auto-discovery. Keep the daemon alive until `serve` ends.
    let _advert = bonjour::advertise(&bonjour::AdvertInfo {
        host: crate::rpc::hostname(),
        user: http::current_user(&ctx.home),
        ssh_port: config.ssh_port,
        pair_port: port,
        version: env!("CARGO_PKG_VERSION").into(),
        fingerprint,
    })
    .map_err(|e| eprintln!("herdlingd serve: bonjour advert failed: {e:#}"))
    .ok();
    eprintln!("herdlingd serve: started");
    tokio::select! {
        _ = watch::watch(&ctx) => {}
        _ = pairing => {}
        _ = shutdown => {}
    }
    Ok(())
}
