//! `tts.make` runs the host's `tts_command`. Scripts stand in for the real tool.

#[path = "support/host_command.rs"]
mod host_command;

use std::time::Duration;

use base64::Engine;
use host_command::{call, script, set_command, wait_dead, Which};
use serde_json::{json, Value};

const T: Duration = Duration::from_secs(5);

async fn tts(home: &std::path::Path, text: &str, timeout: Duration) -> Value {
    call(home, "tts.make", json!({ "text": text }), timeout).await
}

fn with_script(dir: &std::path::Path, body: &str) {
    let s = script(dir, "say.sh", body);
    set_command(dir, Which::Tts, Some(vec![s]));
}

fn decode(r: &Value) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(r["result"]["audio_b64"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn tts_returns_wav_audio() {
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("stdin.txt");
    // A tiny WAV header plus two sample bytes.
    with_script(dir.path(), &format!("cat > '{}'\nprintf 'RIFF\\044\\000\\000\\000WAVEfmt \\001\\002'", seen.display()));
    let r = tts(dir.path(), "Hello there.", T).await;
    assert_eq!(r["result"]["mime"], "audio/wav");
    let audio = decode(&r);
    assert_eq!(&audio[..4], b"RIFF");
    assert_eq!(&audio[8..12], b"WAVE");
    assert_eq!(audio.len(), 18);
    assert_eq!(std::fs::read_to_string(&seen).unwrap(), "Hello there.");
}

#[tokio::test]
async fn tts_detects_mp3_and_ogg() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\nprintf 'ID3\\004rest'");
    assert_eq!(tts(dir.path(), "hi", T).await["result"]["mime"], "audio/mpeg");
    with_script(dir.path(), "cat > /dev/null\nprintf '\\377\\373\\220\\000'");
    assert_eq!(tts(dir.path(), "hi", T).await["result"]["mime"], "audio/mpeg");
    with_script(dir.path(), "cat > /dev/null\nprintf 'OggS\\000\\002'");
    assert_eq!(tts(dir.path(), "hi", T).await["result"]["mime"], "audio/ogg");
}

#[tokio::test]
async fn tts_unknown_format_fails() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\necho 'not audio'");
    let r = tts(dir.path(), "hi", T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    assert_eq!(r["error"]["message"], "unknown audio format");
}

#[tokio::test]
async fn tts_unset_gives_no_command() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(tts(dir.path(), "hi", T).await["error"]["code"], "no_command");
    set_command(dir.path(), Which::Tts, Some(vec![]));
    assert_eq!(tts(dir.path(), "hi", T).await["error"]["code"], "no_command");
}

#[tokio::test]
async fn tts_missing_program_names_only_the_program() {
    let dir = tempfile::tempdir().unwrap();
    set_command(dir.path(), Which::Tts, Some(vec!["/nonexistent/bin/speak-tool".into()]));
    let r = tts(dir.path(), "secret input", T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("speak-tool") && !msg.contains("secret"), "{msg}");
}

#[tokio::test]
async fn tts_timeout_kills_child() {
    let dir = tempfile::tempdir().unwrap();
    let pids = dir.path().join("pids");
    with_script(dir.path(), &format!("echo $$ > '{}'\nexec sleep 30", pids.display()));
    let r = tts(dir.path(), "hi", Duration::from_millis(1500)).await;
    assert_eq!(r["error"]["code"], "timeout");
    assert!(wait_dead(&pids).await);
}

#[tokio::test]
async fn tts_nonzero_exit() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\necho 'voice missing' >&2\nexit 3");
    let r = tts(dir.path(), "secret input", T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("exited with 3") && msg.contains("voice missing"), "{msg}");
    assert!(!msg.contains("secret"), "{msg}");
}

#[tokio::test]
async fn tts_empty_output() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null");
    assert_eq!(tts(dir.path(), "hi", T).await["error"]["code"], "upstream_error");
}

#[tokio::test]
async fn tts_input_is_capped() {
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("stdin.txt");
    with_script(dir.path(), &format!("cat > '{}'\nprintf 'OggS'", seen.display()));
    let text = format!("START{}", "b".repeat(9_000));
    assert_eq!(tts(dir.path(), &text, T).await["result"]["mime"], "audio/ogg");
    let sent = std::fs::read_to_string(&seen).unwrap();
    assert_eq!(sent.chars().count(), 8_000);
    assert!(sent.starts_with("START"));
}
