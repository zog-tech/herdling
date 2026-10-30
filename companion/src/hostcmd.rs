//! Runs a host command from the companion config (`summary_command`, `tts_command`).
//!
//! No shell: the first array item is the program, the rest are its arguments. The input goes
//! to stdin, the output comes from stdout. The command runs in its own process group, and the
//! whole group is killed on timeout or when the request is dropped. Errors never hold the input.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::types::RpcError;

/// Most stderr bytes read. Only the first `STDERR_CHARS` characters reach the error.
const STDERR_READ: u64 = 4096;
/// Most stderr characters put in a `command_failed` message.
pub const STDERR_CHARS: usize = 200;

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// The argv when it names a program; `None` for an unset or empty command.
pub fn argv(cmd: Option<&[String]>) -> Option<&[String]> {
    cmd.filter(|a| a.first().is_some_and(|p| !p.trim().is_empty()))
}

/// Kills the process group on drop unless the command finished.
struct GroupGuard(Option<i32>);

impl Drop for GroupGuard {
    fn drop(&mut self) {
        if let Some(pgid) = self.0 {
            // SAFETY: killpg only sends a signal; a gone group gives ESRCH, which is ignored.
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
    }
}

/// Runs `argv` with `input` on stdin and returns stdout.
///
/// - spawn failure → `command_failed` with the program name only
/// - stdout over `max_out` bytes → `command_failed`
/// - non-zero exit → `command_failed` with the exit code and the start of stderr
/// - no answer in `timeout` → `timeout` (the process group is killed)
/// - empty stdout → `upstream_error`
pub async fn run(argv: &[String], input: Vec<u8>, timeout: Duration, max_out: usize) -> Result<Vec<u8>, RpcError> {
    let program = argv.first().map(String::as_str).unwrap_or_default();
    let name = std::path::Path::new(program).file_name().map_or(program.into(), |n| n.to_string_lossy());
    let mut child = Command::new(program)
        .args(&argv[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| err("command_failed", format!("cannot start {name}")))?;
    let mut guard = GroupGuard(child.id().and_then(|p| i32::try_from(p).ok()));
    let (mut si, so, se) = (child.stdin.take().unwrap(), child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let work = async {
        let feed = async move {
            // A command that does not read all of stdin closes the pipe early; that is fine.
            let _ = si.write_all(&input).await;
            let _ = si.shutdown().await;
        };
        // stdout over its cap is an error, so its pipe closes at the cap and a command that
        // keeps writing gets EPIPE instead of running until the timeout.
        let read_out = async move {
            let mut out = Vec::new();
            so.take(max_out as u64 + 1).read_to_end(&mut out).await.map(|_| out)
        };
        // stderr is only diagnostics: keep the start and drain the rest to EOF, so a chatty
        // command (progress bars, warnings) never gets SIGPIPE.
        let read_err = async move {
            let mut se = se;
            let mut errb = Vec::new();
            (&mut se).take(STDERR_READ).read_to_end(&mut errb).await?;
            tokio::io::copy(&mut se, &mut tokio::io::sink()).await?;
            Ok::<_, std::io::Error>(errb)
        };
        let ((), out, errb) = tokio::join!(feed, read_out, read_err);
        let (out, errb) = (out?, errb?);
        if out.len() > max_out {
            return Ok(Err(err("command_failed", format!("{name} wrote more than {max_out} bytes"))));
        }
        let status = child.wait().await?;
        Ok::<_, std::io::Error>(Ok((status, out, errb)))
    };
    let (status, out, errb) = match tokio::time::timeout(timeout, work).await {
        Err(_) => return Err(err("timeout", format!("{name} took longer than {} s", timeout.as_secs()))),
        Ok(Err(e)) => return Err(err("command_failed", format!("{name}: {}", e.kind()))),
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Ok(Ok(r))) => r,
    };
    guard.0 = None;
    if !status.success() {
        let code = status.code().map_or_else(|| "a signal".to_string(), |c| c.to_string());
        let stderr: String = String::from_utf8_lossy(&errb).trim().chars().take(STDERR_CHARS).collect();
        let mut msg = format!("{name} exited with {code}");
        if !stderr.is_empty() {
            msg.push_str(": ");
            msg.push_str(&stderr);
        }
        return Err(err("command_failed", msg));
    }
    if out.iter().all(u8::is_ascii_whitespace) {
        return Err(err("upstream_error", format!("{name} wrote nothing")));
    }
    Ok(out)
}
