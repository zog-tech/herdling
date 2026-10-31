//! `stt.make` runs the host's `stt_command`. Scripts stand in for the real tool.

#[path = "support/host_command.rs"]
mod host_command;

use std::time::Duration;

use base64::Engine;
use host_command::{call, script, set_command, wait_dead, Which};
use serde_json::{json, Value};

const T: Duration = Duration::from_secs(5);
/// A tiny WAV header plus two sample bytes.
const WAV: &[u8] = b"RIFF\x24\x00\x00\x00WAVEfmt \x01\x02";

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

async fn stt(home: &std::path::Path, audio: &[u8], timeout: Duration) -> Value {
    call(home, "stt.make", json!({ "audio_b64": b64(audio), "mime": "audio/wav" }), timeout).await
}

fn with_script(dir: &std::path::Path, body: &str) {
    let s = script(dir, "hear.sh", body);
    set_command(dir, Which::Stt, Some(vec![s]));
}

#[tokio::test]
async fn stt_returns_trimmed_text_and_gets_the_audio_on_stdin() {
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("stdin.wav");
    with_script(dir.path(), &format!("cat > '{}'\nprintf '  Hello there.\\n\\n'", seen.display()));
    let r = stt(dir.path(), WAV, T).await;
    assert_eq!(r["result"]["text"], "Hello there.");
    assert_eq!(std::fs::read(&seen).unwrap(), WAV);
}

#[tokio::test]
async fn stt_unset_gives_no_command() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(stt(dir.path(), WAV, T).await["error"]["code"], "no_command");
    set_command(dir.path(), Which::Stt, Some(vec![]));
    assert_eq!(stt(dir.path(), WAV, T).await["error"]["code"], "no_command");
}

#[tokio::test]
async fn stt_missing_params_or_bad_audio_is_bad_request() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\necho hi");
    let r = call(dir.path(), "stt.make", json!({}), T).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = call(dir.path(), "stt.make", json!({ "audio_b64": "not base64!" }), T).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = call(dir.path(), "stt.make", json!({ "audio_b64": "" }), T).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn stt_audio_over_the_cap_is_too_large() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\necho hi");
    let big = vec![0u8; herdlingd::stt::MAX_AUDIO + 1];
    assert_eq!(stt(dir.path(), &big, T).await["error"]["code"], "too_large");
}

#[tokio::test]
async fn stt_largest_audio_fits_in_one_request_line() {
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("bytes");
    with_script(dir.path(), &format!("wc -c < /dev/stdin | tr -d ' ' > '{}'\necho ok", seen.display()));
    let audio = vec![7u8; herdlingd::stt::MAX_AUDIO];
    let r = stt(dir.path(), &audio, Duration::from_secs(30)).await;
    assert_eq!(r["result"]["text"], "ok", "{r}");
    assert_eq!(std::fs::read_to_string(&seen).unwrap().trim(), herdlingd::stt::MAX_AUDIO.to_string());
}

#[tokio::test]
async fn stt_missing_program_names_only_the_program() {
    let dir = tempfile::tempdir().unwrap();
    set_command(dir.path(), Which::Stt, Some(vec!["/nonexistent/bin/hear-tool".into()]));
    let r = stt(dir.path(), WAV, T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("hear-tool"), "{msg}");
}

#[tokio::test]
async fn stt_timeout_kills_child() {
    let dir = tempfile::tempdir().unwrap();
    let pids = dir.path().join("pids");
    with_script(dir.path(), &format!("echo $$ > '{}'\nexec sleep 30", pids.display()));
    let r = stt(dir.path(), WAV, Duration::from_millis(1500)).await;
    assert_eq!(r["error"]["code"], "timeout");
    assert!(wait_dead(&pids).await);
}

#[tokio::test]
async fn stt_nonzero_exit() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\necho 'model missing' >&2\nexit 3");
    let r = stt(dir.path(), WAV, T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("exited with 3") && msg.contains("model missing"), "{msg}");
}

#[tokio::test]
async fn stt_output_over_the_cap_fails() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\nhead -c 70000 /dev/zero | tr '\\0' a");
    assert_eq!(stt(dir.path(), WAV, T).await["error"]["code"], "command_failed");
}

#[tokio::test]
async fn stt_empty_output() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null");
    assert_eq!(stt(dir.path(), WAV, T).await["error"]["code"], "upstream_error");
}
