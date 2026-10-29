//! NDJSON JSON-RPC loop. One request per line in, one response per line out.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::herdr::{self, HerdrError};
use crate::types::{Hello, RpcError, RpcRequest, RpcResponse};

#[derive(Clone)]
pub struct Ctx {
    pub herdr_socket: PathBuf,
    pub home: PathBuf,
}

/// Sender side of the single writer task. Later tasks push notifications here too.
pub type Out = mpsc::UnboundedSender<Value>;

pub async fn run<R, W>(input: R, output: W, ctx: Ctx) -> Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let ctx = Arc::new(ctx);
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();

    let writer = tokio::spawn(async move {
        let mut output = output;
        while let Some(msg) = rx.recv().await {
            let mut line = msg.to_string();
            line.push('\n');
            if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err() {
                break;
            }
        }
    });

    let mut lines = input.lines();
    let mut tasks = tokio::task::JoinSet::new();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => {
                let (ctx, tx) = (ctx.clone(), tx.clone());
                tasks.spawn(async move {
                    let resp = match dispatch(&ctx, &req.method, req.params).await {
                        Ok(result) => RpcResponse { id: Some(req.id), result: Some(result), error: None },
                        Err(error) => RpcResponse { id: Some(req.id), result: None, error: Some(error) },
                    };
                    let _ = tx.send(serde_json::to_value(resp).unwrap_or(Value::Null));
                });
            }
            Err(e) => {
                let resp = RpcResponse {
                    id: None,
                    result: None,
                    error: Some(err("bad_request", format!("invalid request: {e}"))),
                };
                let _ = tx.send(serde_json::to_value(resp).unwrap_or(Value::Null));
            }
        }
    }

    // Input closed: let in-flight requests finish, then drain the writer.
    while tasks.join_next().await.is_some() {}
    drop(tx);
    let _ = writer.await;
    Ok(())
}

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// Add new methods here.
async fn dispatch(ctx: &Ctx, method: &str, params: Value) -> Result<Value, RpcError> {
    match method {
        "hello" => hello(ctx).await,
        "herdr.call" => herdr_call(ctx, params).await,
        other => Err(err("unknown_method", format!("unknown method: {other}"))),
    }
}

fn herdr_err(e: HerdrError) -> RpcError {
    match e {
        HerdrError::Unavailable(m) => err("herdr_unavailable", m),
        HerdrError::Remote { code, message } => err(&code, message),
    }
}

async fn hello(ctx: &Ctx) -> Result<Value, RpcError> {
    let mut h = Hello {
        host: hostname(),
        os: if cfg!(target_os = "macos") { "macos" } else { "linux" }.into(),
        zogsshd: env!("CARGO_PKG_VERSION").into(),
        herdr_ok: false,
        herdr_version: None,
        herdr_protocol: None,
    };
    if let Ok(mut c) = herdr::Client::connect(&ctx.herdr_socket).await {
        if let Ok(snap) = c.call("session.snapshot", json!({})).await {
            h.herdr_ok = true;
            let s = snap.get("snapshot").unwrap_or(&snap);
            h.herdr_version = s.get("version").and_then(Value::as_str).map(String::from);
            h.herdr_protocol = s.get("protocol").and_then(Value::as_u64);
        }
    }
    serde_json::to_value(h).map_err(|e| err("internal", e.to_string()))
}

fn hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

async fn herdr_call(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let method = params
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| err("bad_request", "herdr.call requires a method"))?
        .to_string();
    let p = params.get("params").cloned().unwrap_or_else(|| json!({}));
    let mut c = herdr::Client::connect(&ctx.herdr_socket).await.map_err(herdr_err)?;
    c.call(&method, p).await.map_err(herdr_err)
}
