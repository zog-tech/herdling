//! Local HTTP server for tests of outbound calls. Never touches the real network.
#![allow(dead_code)]

use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::Value;
use tokio::sync::mpsc;

/// Received JSON bodies in order.
pub struct MockHttp {
    pub url: String,
    pub bodies: mpsc::UnboundedReceiver<Value>,
    reply: Arc<Mutex<Value>>,
}

impl MockHttp {
    /// Starts a server on `127.0.0.1:0` that answers every POST with `reply`.
    pub async fn start(reply: Value) -> MockHttp {
        let (tx, bodies) = mpsc::unbounded_channel();
        let reply = Arc::new(Mutex::new(reply));
        let app = Router::new()
            .route("/{*path}", post(handle))
            .with_state((tx, reply.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        MockHttp { url: format!("http://{addr}/--/api/v2/push/send"), bodies, reply }
    }

    /// Changes the answer for later requests.
    pub fn set_reply(&self, reply: Value) {
        *self.reply.lock().unwrap() = reply;
    }
}

type Shared = (mpsc::UnboundedSender<Value>, Arc<Mutex<Value>>);

async fn handle(State((tx, reply)): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let _ = tx.send(body);
    let r = reply.lock().unwrap().clone();
    Json(r)
}
