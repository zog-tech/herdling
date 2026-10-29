use std::path::PathBuf;

use anyhow::{bail, Result};
use tokio::io::BufReader;
use zogsshd::rpc;

fn herdr_socket(home: &std::path::Path) -> PathBuf {
    match std::env::var_os("HERDR_SOCKET") {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => home.join(".config/herdr/herdr.sock"),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("rpc") => {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let ctx = rpc::Ctx::new(herdr_socket(&home), home);
            rpc::run(BufReader::new(tokio::io::stdin()), tokio::io::stdout(), ctx).await
        }
        _ => bail!("usage: zogsshd rpc"),
    }
}
