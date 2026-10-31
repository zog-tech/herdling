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
use crate::pair::{self, NewDevice, PairError};
use crate::types::{PairRequest, PairResponse};

/// Largest accepted request body.
pub const BODY_LIMIT: usize = 16 * 1024;

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
        let cfg_dir = ctx.config_path.parent().map(PathBuf::from).unwrap_or_else(|| ctx.home.join(".config/herdling"));
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
                    PairError::UnsafeExe => StatusCode::INTERNAL_SERVER_ERROR,
                };
                error(status, e.code())
            }
            Failure::Internal(e) => {
                eprintln!("herdlingd serve: pairing failed: {e:#}");
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

/// Validates everything before the code is checked, so a malformed request never
/// uses up the window or a wrong-code attempt.
fn pair_blocking(state: &State, req: PairRequest, now: u64) -> Result<PairResponse, Failure> {
    pair::check_code_format(&req.code)?;
    let device = NewDevice::validate(&state.exe, &req.device_id, &req.device_name, &req.host_id, &req.public_key)
        .map_err(|e| match e {
            PairError::UnsafeExe => Failure::Internal(e.into()),
            e => Failure::Pair(e),
        })?;
    let name = device.name.clone();
    let key_fp = pair::key_fingerprint(&device.public_key).unwrap_or_default();

    let _guard = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    pair::take_window(&state.cfg_dir, &req.code, now)?;
    let ssh_port =
        pair::save_device(&state.authorized_keys, &state.config_path, device, req.expo_token).map_err(Failure::Internal)?;
    eprintln!("herdlingd serve: paired device {name}  key {key_fp}");
    Ok(PairResponse {
        host_name: state.host_name.clone(),
        user: state.user.clone(),
        ssh_port,
        host_key_fingerprint: pair::host_fingerprint(&state.host_key_paths),
    })
}
