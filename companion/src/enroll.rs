//! `zogsshd enroll`: adds the phone's restricted key when the app logs in once with the
//! user's SSH password ("Set up with password").
//!
//! It does what `POST /pair` does after the code check, through the same functions in
//! [`crate::pair`]. It needs no pairing window: the caller already logged in as this user.
//!
//! The restricted key of a paired phone cannot run this: its `authorized_keys` line forces
//! `command="<exe> rpc"`, and sshd ignores the command the client asks for.

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::pair::{self, NewDevice, PairError};
use crate::types::{EnrollFailed, EnrollOk, EnrollRequest, EnrollResult};

/// Largest accepted input line.
pub const INPUT_LIMIT: usize = 16 * 1024;

pub struct EnrollCtx {
    pub authorized_keys: PathBuf,
    pub config_path: PathBuf,
    pub exe: PathBuf,
    pub host_key_paths: Vec<PathBuf>,
    pub host_name: String,
}

impl EnrollCtx {
    /// The real paths for the user with home `home`.
    pub fn new(home: &Path, exe: PathBuf) -> EnrollCtx {
        EnrollCtx {
            authorized_keys: home.join(".ssh/authorized_keys"),
            config_path: crate::config::default_path(home),
            exe,
            host_key_paths: pair::default_host_key_paths(),
            host_name: crate::rpc::hostname(),
        }
    }
}

/// Reads one request from `input` and enrolls the device. Returns the JSON line to print
/// (no newline) and the exit code. The line never holds the key.
pub fn run(input: impl Read, ctx: &EnrollCtx) -> (String, i32) {
    let result = match read_line(input) {
        Ok(line) => enroll(&line, ctx),
        Err(e) => Err(e),
    };
    let (out, code) = match result {
        Ok(r) => (r, 0),
        Err(e) => (e, 1),
    };
    (serde_json::to_string(&out).unwrap_or_else(|_| r#"{"ok":false,"code":"io_error","message":"encode"}"#.into()), code)
}

fn fail(code: &str, message: impl Into<String>) -> EnrollResult {
    EnrollResult::Failed(EnrollFailed { ok: false, code: code.into(), message: message.into() })
}

/// The request is one line. Reads up to the first newline or the end of input, so the
/// caller does not need to close stdin (the app's SSH client cannot send EOF).
fn read_line(input: impl Read) -> Result<Vec<u8>, EnrollResult> {
    let mut buf = Vec::new();
    for byte in std::io::BufReader::new(input).bytes().take(INPUT_LIMIT + 1) {
        let b = byte.map_err(|e| fail("io_error", format!("read stdin: {e}")))?;
        if b == b'\n' {
            return Ok(buf);
        }
        buf.push(b);
    }
    if buf.len() > INPUT_LIMIT {
        return Err(fail("bad_request", format!("input is larger than {INPUT_LIMIT} bytes")));
    }
    Ok(buf)
}

fn enroll(line: &[u8], ctx: &EnrollCtx) -> Result<EnrollResult, EnrollResult> {
    let req: EnrollRequest = serde_json::from_slice(line).map_err(|_| fail("bad_request", "input is not an enroll request"))?;
    let device = NewDevice::validate(&ctx.exe, &req.device_id, &req.device_name, &req.host_id, &req.public_key)
        .map_err(|e| match e {
            PairError::BadRequest(m) => fail("bad_request", m),
            e => fail("io_error", e.to_string()),
        })?;
    pair::save_device(&ctx.authorized_keys, &ctx.config_path, device, None).map_err(|e| fail("io_error", format!("{e:#}")))?;
    Ok(EnrollResult::Enrolled(EnrollOk {
        ok: true,
        host_fingerprint: pair::host_fingerprint(&ctx.host_key_paths),
        hostname: ctx.host_name.clone(),
    }))
}
