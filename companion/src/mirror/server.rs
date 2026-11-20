//! The mirror server: the player page and the WebSocket of one mirror, on `127.0.0.1`.
//!
//! Every request must have the path `/m/<token>/` (the page) or `/m/<token>/ws` (the WebSocket),
//! with the 128-bit token of the mirror. Any other path gets 404. The `Host` header must name
//! loopback (no DNS rebinding), and the WebSocket upgrade must come from a page of the same origin.

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;

use super::machine::Input;
use super::stream::{Deliver, ViewerGate};
use super::{Hub, SourceCmd};

/// The player page.
pub const PAGE: &str = include_str!("page.html");
/// The largest message that the page may send.
pub const MAX_MESSAGE: usize = 16 * 1024;
/// The Content Security Policy of the page: inline code only, no other host.
pub const CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; \
connect-src 'self' ws://localhost:* ws://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

#[derive(Clone)]
struct AppState {
    hub: Arc<Hub>,
    token: Arc<String>,
}

/// The routes of one mirror.
pub fn router(hub: Arc<Hub>, token: String) -> Router {
    Router::new()
        .route("/m/{token}/", get(page))
        .route("/m/{token}/ws", get(ws))
        .fallback(|| async { StatusCode::NOT_FOUND })
        .with_state(AppState { hub, token: Arc::new(token) })
}

/// True when `host` (the `Host` header) names loopback: `localhost`, `127.0.0.1` or `[::1]`, with
/// an optional port.
pub fn host_allowed(host: &str) -> bool {
    let name = if let Some(rest) = host.strip_prefix('[') {
        match rest.split_once(']') {
            Some((h, port)) if port.is_empty() || valid_port(port.strip_prefix(':').unwrap_or("x")) => return h == "::1",
            _ => return false,
        }
    } else {
        match host.split_once(':') {
            Some((h, p)) if valid_port(p) => h,
            Some(_) => return false,
            None => host,
        }
    };
    name.eq_ignore_ascii_case("localhost") || name == "127.0.0.1"
}

fn valid_port(p: &str) -> bool {
    !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u16>().is_ok_and(|n| n > 0)
}

/// True when the `Origin` of a WebSocket upgrade is the page origin `http://<host>`. A request
/// with no `Origin` (not from a browser) is refused too.
pub fn origin_allowed(origin: Option<&str>, host: &str) -> bool {
    origin.is_some_and(|o| o.eq_ignore_ascii_case(&format!("http://{host}")))
}

/// Compares two tokens in a time that does not depend on where they differ.
pub fn same_token(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The checks of every request. Returns the host on success.
fn gate<'a>(s: &AppState, token: &str, headers: &'a HeaderMap) -> Result<&'a str, StatusCode> {
    if !same_token(token, &s.token) {
        return Err(StatusCode::NOT_FOUND);
    }
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    if !host_allowed(host) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(host)
}

async fn page(State(s): State<AppState>, Path(token): Path<String>, headers: HeaderMap) -> Response {
    if let Err(code) = gate(&s, &token, &headers) {
        return code.into_response();
    }
    let mut r = PAGE.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    r
}

#[derive(Deserialize)]
struct WsQuery {
    /// `1` when the page can decode H.264.
    video: Option<String>,
}

async fn ws(State(s): State<AppState>, Path(token): Path<String>, Query(q): Query<WsQuery>, headers: HeaderMap, up: WebSocketUpgrade) -> Response {
    let host = match gate(&s, &token, &headers) {
        Ok(h) => h,
        Err(code) => return code.into_response(),
    };
    let origin = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok());
    if !origin_allowed(origin, host) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let video = q.video.as_deref() == Some("1");
    let hub = s.hub.clone();
    up.max_message_size(MAX_MESSAGE).max_frame_size(MAX_MESSAGE).on_upgrade(move |socket| viewer(socket, hub, video))
}

/// One viewer: the cached frames, then the live frames and state messages; input to the source.
async fn viewer(mut socket: WebSocket, hub: Arc<Hub>, video: bool) {
    let (mut frames, mut texts, mut closed, cache, state) = hub.join();
    let is_closed = *closed.borrow();
    if is_closed {
        return;
    }
    hub.event(Input::Joined { video });
    let mut ok = state.is_empty() || socket.send(Message::Text(state.into())).await.is_ok();
    let mut gate = ViewerGate::new(cache.last().map(|f| f.seq));
    for f in cache {
        if !ok {
            break;
        }
        gate.offer(&f);
        ok = socket.send(Message::Binary(f.msg)).await.is_ok();
    }
    if gate.waits_for_key() {
        hub.command(SourceCmd::KeyFrame);
    }
    while ok {
        tokio::select! {
            m = socket.recv() => match m {
                Some(Ok(Message::Text(t))) => {
                    if let Some(i) = super::input::parse_page(t.as_str()) {
                        hub.command(SourceCmd::Input(i));
                    } else if super::input::is_key_frame_request(t.as_str()) {
                        hub.command(SourceCmd::KeyFrame);
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            f = frames.recv() => match f {
                Ok(f) => {
                    if gate.offer(&f) == Deliver::Send {
                        ok = socket.send(Message::Binary(f.msg)).await.is_ok();
                    }
                }
                Err(RecvError::Lagged(_)) => {
                    gate.lagged();
                    hub.command(SourceCmd::KeyFrame);
                }
                Err(RecvError::Closed) => break,
            },
            t = texts.recv() => match t {
                Ok(t) => ok = socket.send(Message::Text(t.into())).await.is_ok(),
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => break,
            },
            _ = wait_closed(&mut closed) => break,
        }
    }
    let _ = socket.send(Message::Close(None)).await;
    hub.event(Input::Left);
}

/// Waits until the hub closes (or its sender goes).
async fn wait_closed(rx: &mut tokio::sync::watch::Receiver<bool>) {
    let _ = rx.wait_for(|c| *c).await;
}
