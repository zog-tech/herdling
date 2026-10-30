use std::collections::HashMap;
use std::path::Path;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

/// Starts a fake herdr on `path`. `responses` maps method name to the `result` value.
/// Unknown methods get an `unknown_method` error.
#[allow(dead_code)]
pub fn spawn(path: &Path, responses: HashMap<String, Value>) {
    spawn_with(path, responses, false)
}

/// Like `spawn`, but closes each connection after one response (herdr 0.9.0 behaviour).
#[allow(dead_code)]
pub fn spawn_one_shot(path: &Path, responses: HashMap<String, Value>) {
    spawn_with(path, responses, true)
}

fn spawn_with(path: &Path, responses: HashMap<String, Value>, one_shot: bool) {
    let listener = UnixListener::bind(path).unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let responses = responses.clone();
            tokio::spawn(async move {
                let (r, mut w) = stream.into_split();
                let mut lines = BufReader::new(r).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let req: Value = serde_json::from_str(&line).unwrap();
                    let method = req["method"].as_str().unwrap_or("");
                    let resp = match responses.get(method) {
                        Some(res) => json!({"id": req["id"], "result": res}),
                        None => json!({"id": req["id"], "error": {"code": "unknown_method", "message": method}}),
                    };
                    let _ = w.write_all(format!("{resp}\n").as_bytes()).await;
                    if one_shot {
                        return;
                    }
                }
            });
        }
    });
}

/// Like `spawn`, but `respond(method, params)` builds each result, so answers can depend
/// on the pane. `None` gives an `unknown_method` error.
#[allow(dead_code)]
pub fn spawn_fn<F>(path: &Path, respond: F)
where
    F: Fn(&str, &Value) -> Option<Value> + Send + Sync + 'static,
{
    let respond = std::sync::Arc::new(respond);
    let listener = UnixListener::bind(path).unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let respond = respond.clone();
            tokio::spawn(async move {
                let (r, mut w) = stream.into_split();
                let mut lines = BufReader::new(r).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let req: Value = serde_json::from_str(&line).unwrap();
                    let method = req["method"].as_str().unwrap_or("");
                    let resp = match respond(method, &req["params"]) {
                        Some(res) => json!({"id": req["id"], "result": res}),
                        None => json!({"id": req["id"], "error": {"code": "unknown_method", "message": method}}),
                    };
                    let _ = w.write_all(format!("{resp}\n").as_bytes()).await;
                }
            });
        }
    });
}
