//! Rust mirrors of the shared protocol types (`protocol/src/index.ts`).


use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    pub herdlingd: String,
    pub herdr_ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herdr_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herdr_protocol: Option<u64>,
    /// Method names this herdlingd accepts. An older herdlingd does not send the field.
    #[serde(default)]
    pub methods: Vec<String>,    /// herdr agent kinds with chat support. An older herdlingd does not send the field.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thread_kinds: Vec<String>,
    /// Agent kinds that `commands.list` answers for. An older herdlingd does not send the field.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command_kinds: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolResult {
    pub ok: bool,
    pub text: String,
    pub truncated: bool,
    /// Unix ms of the log line that holds the result. Missing when the line has no timestamp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ts: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
        /// Unix ms of the first line of the subagent transcript, else of the call.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        started_at: Option<i64>,
        /// Unix ms when the subagent stopped. Missing while it runs or when unknown.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finished_at: Option<i64>,
        /// While running: its latest step ("Read parse.rs", "Bash cargo test"). Max 80 chars.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        activity: Option<String>,
        /// Tool calls in the subagent transcript so far.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_count: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_type: Option<String>,
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

/// `thread.subagent` result: a page plus the subagent transcript path (for `thread.follow`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentPage {
    #[serde(flatten)]
    pub page: ThreadPage,
    pub log_path: String,
    /// True while the subagent runs, false when it stopped. Missing when the host does not know.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running: Option<bool>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quiet_at_desk: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRegister {
    pub device_id: String,
    pub host_id: String,
    pub name: String,
    pub expo_token: Option<String>,
    pub prefs: PushPrefs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairRequest {
    pub code: String,
    pub device_id: String,
    pub device_name: String,
    pub host_id: String,
    pub public_key: String,
    pub expo_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairResponse {
    pub host_name: String,
    pub user: String,
    pub ssh_port: u16,
    pub host_key_fingerprint: Option<String>,
}

/// Input line of `herdlingd enroll` (password setup).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollRequest {
    pub device_id: String,
    pub device_name: String,
    pub host_id: String,
    pub public_key: String,
}

/// `herdlingd enroll` output on success. `ok` is always true.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnrollOk {
    pub ok: bool,
    pub host_fingerprint: Option<String>,
    pub hostname: String,
}

/// `herdlingd enroll` output on failure. `ok` is always false; `code` is `bad_request` or `io_error`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnrollFailed {
    pub ok: bool,
    pub code: String,
    pub message: String,
}

/// The one JSON line `herdlingd enroll` prints.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EnrollResult {
    Enrolled(EnrollOk),
    Failed(EnrollFailed),
}

/// Host load for the Overview meters. Memory is in bytes; `mem_used = total - available`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub cpu_pct: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub load: [f64; 3],
    pub uptime_s: u64,
}

/// One plan-usage window, such as the 5 hour or 7 day limit. `resets_at` is unix seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageWindow {
    pub label: String,
    pub used_pct: f64,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageStatus {
    Ok,
    NotLoggedIn,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub provider: String,
    pub status: UsageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub windows: Vec<UsageWindow>,
}

/// `usage.get`: always both providers, Claude first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    pub providers: Vec<ProviderUsage>,
}

/// `summary.make` result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub summary: String,
}

/// `tts.make` result: the audio bytes as base64 and their mime type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TtsAudio {
    pub audio_b64: String,
    pub mime: String,
}

/// `stt.make` result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SttText {
    pub text: String,
}

/// One automation of `herdr-automate`. Optional fields are left out when absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Automation {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    pub enabled: bool,
    pub pending_approval: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caps: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunStatus {
    Running,
    Ok,
    Failed,
    PendingApproval,
}

/// One run of an automation. Times are unix seconds; `finished_at` is null while running.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: AutomationRunStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// `agents.preview` item: one short line per agent for the Agent Board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentPreview {
    pub pane_id: String,
    /// While working: what the agent does now ("Running pnpm test").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    /// The last assistant text, markdown stripped, one line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reply: Option<String>,
    /// While blocked: the permission question.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
    /// Unix seconds when the current herdr status began; null when unknown.
    pub status_since: Option<i64>,
    /// "log" (agent session log) or "screen" (last line of the pane).
    pub source: String,
}
