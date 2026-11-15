//! The event lines of `herdr.subscribe`: the core events in herdr 1 shapes (see
//! [`super::events::translate`]). The core is the only source. When its stream ends, the last
//! line is `{"closed": true}`, so the app subscribes again and reads a fresh snapshot.

use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::client::{Client, CoreError};
use super::endpoint::CoreSocket;
use super::events::translate;

/// Lines queued for the caller.
const QUEUE: usize = 1024;

/// True when `line` passes the event filter. `None` lets every line pass. A list keeps the lines
/// whose `event` name it has.
pub fn wanted(events: Option<&[String]>, line: &Value) -> bool {
    match events {
        None => true,
        Some(list) => line.get("event").and_then(Value::as_str).is_some_and(|e| list.iter().any(|w| w == e)),
    }
}

/// Opens the stream. Fails when the core does not answer. Dropping the receiver ends the stream
/// and closes the core connection.
pub async fn open(sock: CoreSocket, timeout: Duration, events: Option<Vec<String>>) -> Result<mpsc::Receiver<Value>, CoreError> {
    let c = Client::connect(&sock.current(), timeout).await?;
    let (_, mut sub) = c.subscribe(json!({})).await?;
    let (tx, rx) = mpsc::channel::<Value>(QUEUE);
    let watcher = tx.clone();
    // `Subscription::next` is not safe to cancel, so one task reads it, and a second task stops
    // the reader when the caller drops the receiver.
    let reader = tokio::spawn(async move {
        while let Some(n) = sub.next().await {
            let Some(line) = translate(&n) else { continue };
            if wanted(events.as_deref(), &line) && tx.send(line).await.is_err() {
                return;
            }
        }
        let _ = tx.send(json!({ "closed": true })).await;
    });
    let abort = reader.abort_handle();
    tokio::spawn(async move {
        watcher.closed().await;
        abort.abort();
    });
    Ok(rx)
}
