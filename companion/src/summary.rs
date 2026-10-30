//! `summary.make`: a short spoken summary of an agent reply, made by the host's
//! `summary_command` (any tool: `claude -p`, `ollama run …`, `llm …`).
//!
//! stdin gets [`INSTRUCTIONS`], a blank line, then the text. stdout is the summary.

use std::time::Duration;

use crate::types::RpcError;

/// Longer input keeps its end: the end of a reply says what the agent needs.
pub const MAX_INPUT_CHARS: usize = 24_000;
/// Most summary bytes read from stdout.
pub const MAX_OUTPUT: usize = 16 * 1024;
pub const INSTRUCTIONS: &str = "You summarize a coding agent's reply for someone listening on headphones. \
Say in 2 or 3 short sentences what the agent did and what it needs from the user. No markdown, no code, no lists.";
/// Bound for one summary command. The app waits a little longer.
pub const TIMEOUT: Duration = Duration::from_secs(20);

/// The last `MAX_INPUT_CHARS` characters of `text`.
pub fn clip(text: &str) -> &str {
    let n = text.chars().count();
    if n <= MAX_INPUT_CHARS {
        return text;
    }
    let start = text.char_indices().nth(n - MAX_INPUT_CHARS).map_or(0, |(i, _)| i);
    &text[start..]
}

/// The bytes written to the command's stdin.
pub fn stdin_for(text: &str) -> Vec<u8> {
    format!("{INSTRUCTIONS}\n\n{}", clip(text)).into_bytes()
}

/// Runs `argv` on `text` and returns the trimmed summary.
pub async fn make(argv: &[String], text: &str, timeout: Duration) -> Result<String, RpcError> {
    let out = crate::hostcmd::run(argv, stdin_for(text), timeout, MAX_OUTPUT).await?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}
