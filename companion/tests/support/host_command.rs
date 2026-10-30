//! Shared by the `summary.make` and `tts.make` tests: small scripts and one rpc round trip.
#![allow(dead_code)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::rpc::{self, Ctx};

/// Writes an executable `#!/bin/sh` script named `name` into `dir`.
pub fn script(dir: &Path, name: &str, body: &str) -> String {
    let p = dir.join(name);
    std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p.to_string_lossy().into_owned()
}

/// Which command the config names.
pub enum Which {
    Summary,
    Tts,
}

pub fn set_command(home: &Path, which: Which, argv: Option<Vec<String>>) {
    let path = zogsshd::config::default_path(home);
    zogsshd::config::update(&path, |c| match which {
        Which::Summary => c.summary_command = argv,
        Which::Tts => c.tts_command = argv,
    })
    .unwrap();
}

/// Runs one request with `timeout` for both commands and returns the whole response line.
pub async fn call(home: &Path, method: &str, params: Value, timeout: Duration) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 20);
    let (server_out, client_rx) = tokio::io::duplex(1 << 24);
    let mut ctx = Ctx::new(home.join("none.sock"), PathBuf::from(home));
    ctx.summary_timeout = timeout;
    ctx.tts_timeout = timeout;
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let req = json!({ "id": 1, "method": method, "params": params });
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let line = BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap();
    serde_json::from_str(&line).unwrap()
}

/// Whether `pid` is gone or a zombie (killed, not yet reaped).
pub fn dead(pid: &str) -> bool {
    let out = std::process::Command::new("ps").args(["-o", "stat=", "-p", pid]).output().unwrap();
    let stat = String::from_utf8_lossy(&out.stdout);
    stat.trim().is_empty() || stat.trim().starts_with('Z')
}

/// Waits up to 2 s for every pid in `pid_file` (one per line) to die.
pub async fn wait_dead(pid_file: &Path) -> bool {
    // A first run of a new script can be slow on macOS; a missing file means it never started.
    let pids = std::fs::read_to_string(pid_file).expect("the script wrote its pid before the timeout");
    for _ in 0..40 {
        if pids.lines().all(|p| dead(p.trim())) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}
