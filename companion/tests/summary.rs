//! `summary.make` runs the host's `summary_command`. Scripts stand in for the real tool.

#[path = "support/host_command.rs"]
mod host_command;

use std::time::Duration;

use host_command::{call, script, set_command, wait_dead, Which};
use serde_json::{json, Value};
use herdlingd::summary::INSTRUCTIONS;

const T: Duration = Duration::from_secs(5);

async fn summary(home: &std::path::Path, text: &str, timeout: Duration) -> Value {
    call(home, "summary.make", json!({ "text": text }), timeout).await
}

fn with_script(dir: &std::path::Path, body: &str) {
    let s = script(dir, "sum.sh", body);
    set_command(dir, Which::Summary, Some(vec![s]));
}

#[tokio::test]
async fn summary_runs_command_with_instructions_and_text() {
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("stdin.txt");
    let args = dir.path().join("args.txt");
    let s = script(dir.path(), "sum.sh", &format!("cat > '{}'\necho \"$@\" > '{}'\necho '  Did X. Needs Y.  '", seen.display(), args.display()));
    set_command(dir.path(), Which::Summary, Some(vec![s, "-p".into(), "two words".into()]));
    let r = summary(dir.path(), "The agent edited main.rs.", T).await;
    assert_eq!(r["result"], json!({ "summary": "Did X. Needs Y." }));
    let stdin = std::fs::read_to_string(&seen).unwrap();
    assert_eq!(stdin, format!("{INSTRUCTIONS}\n\nThe agent edited main.rs."));
    // Arguments pass as given, with no shell splitting.
    assert_eq!(std::fs::read_to_string(&args).unwrap(), "-p two words\n");
}

#[tokio::test]
async fn summary_unset_gives_no_command() {
    let dir = tempfile::tempdir().unwrap();
    let r = summary(dir.path(), "hi", T).await;
    assert_eq!(r["error"]["code"], "no_command");
    // An empty array, or an empty program, is unset too.
    set_command(dir.path(), Which::Summary, Some(vec![]));
    assert_eq!(summary(dir.path(), "hi", T).await["error"]["code"], "no_command");
    set_command(dir.path(), Which::Summary, Some(vec![" ".into()]));
    assert_eq!(summary(dir.path(), "hi", T).await["error"]["code"], "no_command");
}

#[tokio::test]
async fn summary_missing_program_names_only_the_program() {
    let dir = tempfile::tempdir().unwrap();
    set_command(dir.path(), Which::Summary, Some(vec!["/nonexistent/bin/summarize-tool".into()]));
    let r = summary(dir.path(), "secret input", T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("summarize-tool"), "{msg}");
    assert!(!msg.contains("secret"), "{msg}");
}

#[tokio::test]
async fn summary_timeout_kills_child() {
    let dir = tempfile::tempdir().unwrap();
    let pids = dir.path().join("pids");
    // The script and a grandchild both run until killed.
    with_script(dir.path(), &format!("sleep 30 &\necho $! > '{p}'\necho $$ >> '{p}'\nwait", p = pids.display()));
    let r = summary(dir.path(), "hi", Duration::from_millis(1500)).await;
    assert_eq!(r["error"]["code"], "timeout");
    assert!(wait_dead(&pids).await, "the command and its children are killed");
}

#[tokio::test]
async fn summary_nonzero_exit() {
    let dir = tempfile::tempdir().unwrap();
    let long = "e".repeat(500);
    with_script(dir.path(), &format!("cat > /dev/null\necho 'model not found {long}' >&2\nexit 3"));
    let r = summary(dir.path(), "secret input", T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("exited with 3"), "{msg}");
    assert!(msg.contains("model not found"), "{msg}");
    assert!(!msg.contains("secret"), "{msg}");
    // At most 200 characters of stderr.
    assert!(msg.len() < "sum.sh exited with 3: ".len() + 201, "{msg}");
}

#[tokio::test]
async fn summary_chatty_stderr_still_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    // About 64 KiB of stderr, then a good answer and exit 0. A closed stderr pipe kills `tr`
    // with SIGPIPE, and the script then exits 9, like a tool that dies on EPIPE.
    with_script(dir.path(), "cat > /dev/null\nhead -c 65536 /dev/zero | tr '\\0' x >&2 || exit 9\necho 'Did X.'");
    let r = summary(dir.path(), "hi", T).await;
    assert_eq!(r["result"], json!({ "summary": "Did X." }), "{r}");
}

#[tokio::test]
async fn summary_empty_output() {
    let dir = tempfile::tempdir().unwrap();
    with_script(dir.path(), "cat > /dev/null\necho '   '");
    let r = summary(dir.path(), "hi", T).await;
    assert_eq!(r["error"]["code"], "upstream_error");
}

#[tokio::test]
async fn summary_output_over_cap_fails() {
    let dir = tempfile::tempdir().unwrap();
    // `yes` writes forever; the pipe closes at the cap and the request ends well before the timeout.
    with_script(dir.path(), "cat > /dev/null\nexec yes");
    let start = std::time::Instant::now();
    let r = summary(dir.path(), "hi", T).await;
    assert_eq!(r["error"]["code"], "command_failed");
    assert!(start.elapsed() < Duration::from_secs(3));
}

#[tokio::test]
async fn summary_requires_text() {
    let dir = tempfile::tempdir().unwrap();
    let r = call(dir.path(), "summary.make", json!({}), T).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn long_input_keeps_end() {
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("stdin.txt");
    with_script(dir.path(), &format!("cat > '{}'\necho ok", seen.display()));
    let text = format!("{}END", "a".repeat(29_997));
    let r = summary(dir.path(), &text, T).await;
    assert_eq!(r["result"]["summary"], "ok");
    let stdin = std::fs::read_to_string(&seen).unwrap();
    let sent = stdin.strip_prefix(&format!("{INSTRUCTIONS}\n\n")).unwrap();
    assert_eq!(sent.chars().count(), 24_000);
    assert!(sent.ends_with("END"));
}

#[test]
fn clip_counts_characters() {
    let text = "é".repeat(24_001);
    assert_eq!(herdlingd::summary::clip(&text).chars().count(), 24_000);
    assert_eq!(herdlingd::summary::clip("short"), "short");
}

#[tokio::test]
async fn old_config_with_anthropic_key_still_loads() {
    let dir = tempfile::tempdir().unwrap();
    let path = herdlingd::config::default_path(dir.path());
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "anthropic_key = \"sk-old\"\npair_port = 7791\n").unwrap();
    let cfg = herdlingd::config::load(&path).unwrap();
    assert_eq!(cfg.pair_port, 7791);
    assert_eq!(cfg.summary_command, None);
    // summary.make reports the missing command, not a config error.
    let r = summary(dir.path(), "hi", T).await;
    assert_eq!(r["error"]["code"], "no_command");
    // The next write drops the old key.
    herdlingd::config::update(&path, |_| ()).unwrap();
    assert!(!std::fs::read_to_string(&path).unwrap().contains("sk-old"));
}
