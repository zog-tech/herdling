//! Rust mirrors of the shared protocol types (`protocol/src/index.ts`).


use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    Blocked,
    Done,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub id: i64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    /// `None` serializes as `null` (bad request with no usable id).
    pub id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventParams {
    pub stream: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcEvent {
    pub method: String,
    pub params: EventParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hello {
    pub host: String,
    pub os: String,
    pub zogsshd: String,
    pub herdr_ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herdr_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herdr_protocol: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub ok: bool,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ThreadItem {
    User {
        id: String,
        ts: i64,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        images: Option<u32>,
    },
    Assistant {
        id: String,
        ts: i64,
        markdown: String,
    },
    Thinking {
        id: String,
        ts: i64,
        text: Option<String>,
    },
    Tool {
        id: String,
        ts: i64,
        name: String,
        input_summary: String,
        input: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<ToolResult>,
    },
    Subagent {
        id: String,
        ts: i64,
        agent_id: String,
        description: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result_summary: Option<String>,
    },
    System {
        id: String,
        ts: i64,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadPage {
    pub items: Vec<ThreadItem>,
    pub cursor: Option<u64>,
    pub end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadRef {
    pub kind: String,
    pub session: Option<String>,
    pub log_path: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentSession {
    pub session: String,
    pub first_prompt: String,
    pub last_activity: i64,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushPrefs {
    pub finished: bool,
    pub needs_you: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRegister {
    pub device_id: String,
    pub host_id: String,
    pub name: String,
    pub expo_token: Option<String>,
    pub prefs: PushPrefs,
}
