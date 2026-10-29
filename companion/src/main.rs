use std::path::PathBuf;

use anyhow::{bail, Result};
use tokio::io::BufReader;
use std::time::Duration;
use zogsshd::{config, rpc, serve};

fn herdr_socket(home: &std::path::Path) -> PathBuf {
    match std::env::var_os("HERDR_SOCKET") {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => home.join(".config/herdr/herdr.sock"),
    }
}

async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    match signal(SignalKind::terminate()) {
        Ok(mut term) => tokio::select! {
            _ = term.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        },
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("rpc") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let ctx = rpc::Ctx::new(herdr_socket(&home), home);
            let result = rpc::run(BufReader::new(tokio::io::stdin()), tokio::io::stdout(), ctx).await;
            // Exit at once: tokio reads stdin on a blocking thread that cannot be
            // cancelled, so a normal runtime shutdown would wait for the next input line.
            std::process::exit(match result {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("zogsshd: {e:#}");
                    1
                }
            })
        }
        Some("serve") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let ctx = serve::ServeCtx {
                herdr_socket: herdr_socket(&home),
                config_path: config::default_path(&home),
                home,
                push_url: "https://exp.host/--/api/v2/push/send".into(),
                debounce: Duration::from_secs(5),
                pair_port: None,
                host_key_paths: vec![PathBuf::from("/etc/ssh/ssh_host_ed25519_key.pub")],
                exe: std::env::current_exe()?.canonicalize()?,
            };
            serve::run(ctx, shutdown_signal()).await
        }
        _ => bail!("usage: zogsshd rpc | serve"),
    }
}
