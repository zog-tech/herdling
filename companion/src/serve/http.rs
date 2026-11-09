//! Pairing HTTP endpoint of `serve`: `POST /pair` (v1, the code in clear for older apps) and
//! `POST /pair/v2/start` and `POST /pair/v2/finish` (v2, CPace: see `crate::pair_v2`).

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
use crate::pair_v2::{self, Session, Sessions};
use crate::types::{
    PairRequest, PairResponse, PairV2FinishRequest, PairV2FinishResponse, PairV2StartRequest, PairV2StartResponse,
};

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
    /// Started v2 exchanges.
    sessions: Mutex<Sessions>,
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
            sessions: Mutex::new(Sessions::default()),
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
        .route("/pair/v2/start", post(start_handler))
        .route("/pair/v2/finish", post(finish_handler))
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
                    PairError::NoSession => StatusCode::GONE,
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

/// Parses the JSON body and runs `f` on a blocking thread (it takes file locks).
async fn run_blocking<Req, Resp>(
    state: Arc<State>,
    body: Result<Bytes, BytesRejection>,
    f: fn(&State, Req, u64) -> Result<Resp, Failure>,
) -> Response
where
    Req: serde::de::DeserializeOwned + Send + 'static,
    Resp: serde::Serialize + Send + 'static,
{
    let bad = || Failure::Pair(PairError::BadRequest("invalid body".into())).into_response();
    let Ok(body) = body else { return bad() };
    let Ok(req) = serde_json::from_slice::<Req>(&body) else { return bad() };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    match tokio::task::spawn_blocking(move || f(&state, req, now)).await {
        Ok(Ok(resp)) => Json(resp).into_response(),
        Ok(Err(f)) => f.into_response(),
        Err(e) => Failure::Internal(e.into()).into_response(),
    }
}

async fn pair_handler(AxState(state): AxState<Arc<State>>, body: Result<Bytes, BytesRejection>) -> Response {
    run_blocking(state, body, pair_blocking).await
}

async fn start_handler(AxState(state): AxState<Arc<State>>, body: Result<Bytes, BytesRejection>) -> Response {
    run_blocking(state, body, start_blocking).await
}

async fn finish_handler(AxState(state): AxState<Arc<State>>, body: Result<Bytes, BytesRejection>) -> Response {
    run_blocking(state, body, finish_blocking).await
}

fn bad_request(m: &str) -> Failure {
    Failure::Pair(PairError::BadRequest(m.into()))
}

/// Random bytes from the operating system generator.
fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    rand::Rng::fill(&mut rand::rng(), &mut b[..]);
    b
}

/// v2 start: checks the phone's CPace message, takes one try of the window and answers with Yb.
/// A malformed request never uses a try.
fn start_blocking(state: &State, req: PairV2StartRequest, now: u64) -> Result<PairV2StartResponse, Failure> {
    pair::check_id(&req.device_id, "device_id")?;
    let sid = pair_v2::unhex::<{ pair_v2::NONCE_LEN }>(&req.sid).ok_or_else(|| bad_request("invalid sid"))?;
    let ya = pair_v2::unhex::<32>(&req.ya).ok_or_else(|| bad_request("invalid ya"))?;
    if !crate::cpace::is_valid_share(&ya) {
        return Err(bad_request("invalid ya"));
    }
    let _guard = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let mut sessions = state.sessions.lock().unwrap_or_else(|p| p.into_inner());
    if !sessions.has_room(now) {
        return Err(PairError::TooManyAttempts.into());
    }
    let code = pair::reserve_try(&state.cfg_dir, now)?;
    let adb: [u8; pair_v2::NONCE_LEN] = random();
    let ada = pair_v2::ada(&req.device_id);
    // A zero scalar has a chance of 2^-252; take new bytes then.
    let r = loop {
        if let Some(r) = pair_v2::respond(&code, &sid, &ya, &ada, &adb, random()) {
            break r;
        }
    };
    sessions.insert(Session {
        device_id: req.device_id,
        code,
        ya,
        ada,
        yb: r.yb,
        adb,
        mac_key: r.mac_key,
        expires_at: now + pair_v2::SESSION_TTL.as_secs(),
    });
    Ok(PairV2StartResponse { session: pair_v2::hex(&adb), yb: pair_v2::hex(&r.yb) })
}

/// v2 finish: checks the phone's tag over its key and fields, then saves the device. A wrong
/// tag counts as a wrong code. The answer carries the host's tag over the host fields.
fn finish_blocking(state: &State, req: PairV2FinishRequest, now: u64) -> Result<PairV2FinishResponse, Failure> {
    let id = pair_v2::unhex::<{ pair_v2::NONCE_LEN }>(&req.session).ok_or_else(|| bad_request("invalid session"))?;
    let tag_a = pair_v2::unhex::<{ pair_v2::TAG_LEN }>(&req.tag_a).ok_or_else(|| bad_request("invalid tag_a"))?;
    let _guard = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let (session, device) = {
        let mut sessions = state.sessions.lock().unwrap_or_else(|p| p.into_inner());
        let device_id = sessions.device_id(&id, now).ok_or(PairError::NoSession)?;
        // A malformed request keeps the session, so the phone can send a fixed one.
        let device = NewDevice::validate(&state.exe, device_id, &req.device_name, &req.host_id, &req.public_key)
            .map_err(|e| match e {
                PairError::UnsafeExe => Failure::Internal(e.into()),
                e => Failure::Pair(e),
            })?;
        (sessions.take(&id, now).ok_or(PairError::NoSession)?, device)
    };
    let msg = pair_v2::tag_a_msg(&session.ya, &session.ada, &req.device_name, &req.host_id, &req.public_key);
    let proof_ok = crate::cpace::hmac_verify(&session.mac_key, &msg, &tag_a);
    let name = device.name.clone();
    let key = device.public_key.clone();
    let key_fp = pair::key_fingerprint(&device.public_key).unwrap_or_default();
    let ssh_port = pair::settle_try(&state.cfg_dir, &session.code, now, proof_ok, || {
        let port = pair::save_device(&state.authorized_keys, &state.config_path, device, None)?;
        // Without the note, `herdlingd pair` asks the user to compare the keys: safe, only slower.
        if let Err(e) = pair::record_checked(&state.cfg_dir, &session.device_id, &key) {
            eprintln!("herdlingd serve: cannot note the checked pairing: {e}");
        }
        Ok::<u16, anyhow::Error>(port)
    })?
    .map_err(Failure::Internal)?;
    eprintln!("herdlingd serve: paired device {name}  key {key_fp} (checked with the code)");
    let fingerprint = pair::host_fingerprint(&state.host_key_paths);
    let tag_b = crate::cpace::hmac_sha512(
        &session.mac_key,
        &pair_v2::tag_b_msg(&session.yb, &session.adb, &tag_a, &state.host_name, &state.user, ssh_port, fingerprint.as_deref()),
    );
    Ok(PairV2FinishResponse {
        host_name: state.host_name.clone(),
        user: state.user.clone(),
        ssh_port,
        host_key_fingerprint: fingerprint,
        tag_b: pair_v2::hex(&tag_b),
    })
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
    // Save first, then close the window: a failed save keeps the code for a retry.
    let ssh_port = pair::take_window_with(&state.cfg_dir, &req.code, now, || {
        pair::save_device(&state.authorized_keys, &state.config_path, device, req.expo_token)
    })?
    .map_err(Failure::Internal)?;
    eprintln!("herdlingd serve: paired device {name}  key {key_fp}");
    Ok(PairResponse {
        host_name: state.host_name.clone(),
        user: state.user.clone(),
        ssh_port,
        host_key_fingerprint: pair::host_fingerprint(&state.host_key_paths),
    })
}
