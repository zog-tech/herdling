//! Adapter for the `herdr-automate` CLI. The CLI contract is assumed, not documented:
//! only `parse_list` and `parse_runs` need to change when the real output differs.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::types::{Automation, AutomationRun, RpcError};

pub const BIN: &str = "herdr-automate";
/// Longest wait for one CLI call.
pub const TIMEOUT: Duration = Duration::from_secs(15);
/// Most output bytes read from the CLI.
const MAX_OUTPUT: u64 = 4 << 20;

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// Directories searched for the CLI: every `$PATH` entry, then `~/.local/bin` and `~/.cargo/bin`.
/// A launchd or sshd environment often has a short `$PATH`, so the usual user bin dirs are added.
pub fn default_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).filter(|d| !d.as_os_str().is_empty()).collect())
        .unwrap_or_default();
    for extra in [home.join(".local/bin"), home.join(".cargo/bin")] {
        if !dirs.contains(&extra) {
            dirs.push(extra);
        }
    }
    dirs
}

fn find_bin(bin_dirs: &[PathBuf]) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    bin_dirs.iter().map(|d| d.join(BIN)).find(|p| {
        std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    })
}

/// Runs the CLI without a shell and returns its stdout.
async fn run(bin_dirs: &[PathBuf], args: &[&str]) -> Result<String, RpcError> {
    let bin = find_bin(bin_dirs).ok_or_else(|| err("not_installed", format!("{BIN} is not installed")))?;
    let mut child = Command::new(&bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| err("automate_failed", format!("cannot start {BIN}: {e}")))?;
    let (mut so, mut se) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let work = async {
        let (mut out, mut errb) = (Vec::new(), Vec::new());
        let (mut so, mut se) = ((&mut so).take(MAX_OUTPUT), (&mut se).take(MAX_OUTPUT));
        let (a, b) = tokio::join!(so.read_to_end(&mut out), se.read_to_end(&mut errb));
        a.and(b)?;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, out, errb))
    };
    let (status, out, errb) = match tokio::time::timeout(TIMEOUT, work).await {
        Err(_) => return Err(err("automate_failed", format!("{BIN} timed out"))),
        Ok(Err(e)) => return Err(err("automate_failed", e.to_string())),
        Ok(Ok(r)) => r,
    };
    if !status.success() {
        let line = String::from_utf8_lossy(&errb).lines().next().unwrap_or("").trim().to_string();
        let line = if line.is_empty() { format!("{BIN} exited with {status}") } else { line };
        return Err(err("automate_failed", line));
    }
    String::from_utf8(out).map_err(|_| err("bad_output", "output is not UTF-8"))
}

/// Accepts a bare array or an object holding the array under `key`.
fn items(text: &str, key: &str) -> Result<Vec<Value>, RpcError> {
    let v: Value = serde_json::from_str(text).map_err(|e| err("bad_output", format!("not JSON: {e}")))?;
    match v {
        Value::Array(a) => Ok(a),
        Value::Object(mut o) => match o.remove(key) {
            Some(Value::Array(a)) => Ok(a),
            _ => Err(err("bad_output", format!("missing {key} array"))),
        },
        _ => Err(err("bad_output", "expected an array")),
    }
}

fn parse_items<T: serde::de::DeserializeOwned>(text: &str, key: &str) -> Result<Vec<T>, RpcError> {
    items(text, key)?
        .into_iter()
        .map(|v| serde_json::from_value(v).map_err(|e| err("bad_output", e.to_string())))
        .collect()
}

pub fn parse_list(text: &str) -> Result<Vec<Automation>, RpcError> {
    parse_items(text, "automations")
}

pub fn parse_runs(text: &str) -> Result<Vec<AutomationRun>, RpcError> {
    parse_items(text, "runs")
}

pub async fn list(bin_dirs: &[PathBuf]) -> Result<Vec<Automation>, RpcError> {
    parse_list(&run(bin_dirs, &["list", "--json"]).await?)
}

pub async fn runs(bin_dirs: &[PathBuf], id: Option<&str>, limit: u64) -> Result<Vec<AutomationRun>, RpcError> {
    let limit = limit.to_string();
    let mut args = vec!["runs", "--json"];
    if let Some(id) = id {
        check_arg(id, "id")?;
        args.extend(["--id", id]);
    }
    args.extend(["--limit", &limit]);
    parse_runs(&run(bin_dirs, &args).await?)
}

pub async fn approve(bin_dirs: &[PathBuf], id: &str, content_hash: &str) -> Result<(), RpcError> {
    check_arg(id, "id")?;
    check_arg(content_hash, "content_hash")?;
    run(bin_dirs, &["approve", id, "--hash", content_hash]).await.map(|_| ())
}

/// A value passed as an argument must not read as an option.
fn check_arg(v: &str, name: &str) -> Result<(), RpcError> {
    if v.is_empty() || v.starts_with('-') || v.contains('\0') {
        return Err(err("bad_request", format!("invalid {name}")));
    }
    Ok(())
}
