//! Pairing HTTP endpoint of `serve`: `POST /pair`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::extract::{DefaultBodyLimit, State as AxState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;
use tokio::net::TcpListener;

use super::ServeCtx;
use crate::config::{self, Device, Prefs};
use crate::pair::{self, PairError};
use crate::types::{PairRequest, PairResponse};

/// Largest accepted request body.
pub const BODY_LIMIT: usize = 16 * 1024;
/// Longest accepted `device_id` or `host_id`.
const MAX_ID: usize = 128;

pub struct State {
    authorized_keys: PathBuf,
    config_path: PathBuf,
    cfg_dir: PathBuf,
    exe: PathBuf,
    host_key_paths: Vec<PathBuf>,
    host_name: String,
    user: String,
    /// One pairing at a time, so the wrong-code counter cannot be raced.
    lock: Mutex<()>,
}

impl State {
    pub fn new(ctx: &ServeCtx) -> Arc<State> {
        let cfg_dir = ctx.config_path.parent().map(PathBuf::from).unwrap_or_else(|| ctx.home.join(".config/zogsshd"));
        Arc::new(State {
            authorized_keys: ctx.home.join(".ssh/authorized_keys"),
            config_path: ctx.config_path.clone(),
            cfg_dir,
            exe: ctx.exe.clone(),
            host_key_paths: ctx.host_key_paths.clone(),
            host_name: crate::rpc::hostname(),
            user: current_user(&ctx.home),
            lock: Mutex::new(()),
        })
    }
}

/// `$USER`, else `$LOGNAME`, else the last part of the home path.
pub(crate) fn current_user(home: &std::path::Path) -> String {
    ["USER", "LOGNAME"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .or_else(|| home.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

pub fn router(state: Arc<State>) -> Router {
    Router::new()
        .route("/pair", post(pair_handler))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

pub async fn serve(listener: TcpListener, state: Arc<State>) -> std::io::Result<()> {
    axum::serve(listener, router(state)).await
}

enum Failure {
    Pair(PairError),
    Internal(anyhow::Error),
}

impl From<PairError> for Failure {
    fn from(e: PairError) -> Self {
        Failure::Pair(e)
    }
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        match self {
            Failure::Pair(e) => {
                let status = match e {
                    PairError::BadRequest(_) => StatusCode::BAD_REQUEST,
                    PairError::NoWindow => StatusCode::GONE,
                    PairError::BadCode => StatusCode::FORBIDDEN,
                    PairError::TooManyAttempts => StatusCode::TOO_MANY_REQUESTS,
                };
                error(status, e.code())
            }
            Failure::Internal(e) => {
                eprintln!("zogsshd serve: pairing failed: {e:#}");
                error(StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        }
    }
}

async fn pair_handler(AxState(state): AxState<Arc<State>>, body: Result<Bytes, BytesRejection>) -> Response {
    let bad = || Failure::Pair(PairError::BadRequest("invalid body".into())).into_response();
    let Ok(body) = body else { return bad() };
    let Ok(req) = serde_json::from_slice::<PairRequest>(&body) else { return bad() };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    match tokio::task::spawn_blocking(move || pair_blocking(&state, req, now)).await {
        Ok(Ok(resp)) => Json(resp).into_response(),
        Ok(Err(f)) => f.into_response(),
        Err(e) => Failure::Internal(e.into()).into_response(),
    }
}

fn check_id(v: &str, field: &str) -> Result<(), PairError> {
    if v.is_empty() || v.len() > MAX_ID || v.chars().any(char::is_control) {
        return Err(PairError::BadRequest(format!("invalid {field}")));
    }
    Ok(())
}

/// Validates everything before the code is checked, so a malformed request never
/// uses up the window or a wrong-code attempt.
fn pair_blocking(state: &State, req: PairRequest, now: u64) -> Result<PairResponse, Failure> {
    pair::check_code_format(&req.code)?;
    check_id(&req.device_id, "device_id")?;
    check_id(&req.host_id, "host_id")?;
    let public_key = pair::parse_public_key(&req.public_key)?;
    // The key is valid here, so a key_line error means the companion path is unsafe: a server fault.
    let line = pair::key_line(&state.exe, &public_key, &req.device_name).map_err(|e| Failure::Internal(e.into()))?;
    let name = pair::sanitize_name(&req.device_name);

    let _guard = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    pair::take_window(&state.cfg_dir, &req.code, now)?;
    // Re-pairing a device with a new key: its old key line must go, or the old key keeps
    // access that a later `pair.revoke` (which sends the current key) cannot remove.
    let old_key = config::load(&state.config_path)
        .map_err(Failure::Internal)?
        .devices
        .into_iter()
        .find(|d| d.id == req.device_id)
        .and_then(|d| d.public_key)
        .filter(|k| *k != public_key);
    if let Some(old) = old_key {
        pair::remove_zogssh_key(&state.authorized_keys, &old).map_err(|e| Failure::Internal(e.into()))?;
    }
    pair::append_key(&state.authorized_keys, &line).map_err(|e| Failure::Internal(e.into()))?;
    let device = Device {
        id: req.device_id,
        name: name.clone(),
        host_id: req.host_id,
        public_key: Some(public_key),
        expo_token: req.expo_token,
        prefs: Prefs::default(),
    };
    let ssh_port = config::update(&state.config_path, |c| {
        config::upsert_device(c, device);
        c.ssh_port
    })
    .map_err(Failure::Internal)?;
    eprintln!("zogsshd serve: paired device {name}");
    Ok(PairResponse {
        host_name: state.host_name.clone(),
        user: state.user.clone(),
        ssh_port,
        host_key_fingerprint: pair::host_fingerprint(&state.host_key_paths),
    })
}
