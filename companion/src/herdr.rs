//! Client for the herdr unix socket (NDJSON request/response).

use std::path::Path;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;

#[derive(Debug, thiserror::Error)]
pub enum HerdrError {
    #[error("herdr unavailable: {0}")]
    Unavailable(String),
    #[error("herdr error {code}: {message}")]
    Remote { code: String, message: String },
}

pub struct Client {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
    next_id: u64,
}

impl Client {
    pub async fn connect(path: &Path) -> Result<Client, HerdrError> {
        let stream = UnixStream::connect(path)
            .await
            .map_err(|e| HerdrError::Unavailable(e.to_string()))?;
        let (r, w) = stream.into_split();
        Ok(Client { reader: BufReader::new(r), writer: w, next_id: 1 })
    }

    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, HerdrError> {
        let id = self.next_id.to_string();
        self.next_id += 1;
        let mut line = json!({ "id": id, "method": method, "params": params }).to_string();
        line.push('\n');
        self.writer
            .write_all(line.as_bytes())
            .await
            .map_err(|e| HerdrError::Unavailable(e.to_string()))?;
        loop {
            let mut buf = String::new();
            let n = self
                .reader
                .read_line(&mut buf)
                .await
                .map_err(|e| HerdrError::Unavailable(e.to_string()))?;
            if n == 0 {
                return Err(HerdrError::Unavailable("socket closed".into()));
            }
            let Ok(v) = serde_json::from_str::<Value>(&buf) else { continue };
            if v.get("id").and_then(Value::as_str) != Some(id.as_str()) {
                continue;
            }
            if let Some(err) = v.get("error") {
                return Err(HerdrError::Remote {
                    code: err.get("code").and_then(Value::as_str).unwrap_or("error").to_string(),
                    message: err.get("message").and_then(Value::as_str).unwrap_or("").to_string(),
                });
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}
