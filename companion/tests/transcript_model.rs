//! The current model of an agent from its transcript: Claude Code, Codex, Pi, Gemini CLI, OpenCode.

use std::path::{Path, PathBuf};

use herdlingd::transcript::model::{self, line_model, switched_model, ModelWatch};
use herdlingd::transcript::{codex, opencode, pi, Agent};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

const CWD: &str = "/home/sam/project";

fn lines(v: &[Value]) -> String {
    v.iter().map(|l| l.to_string() + "\n").collect()
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn append(path: &Path, v: &[Value]) {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    f.write_all(lines(v).as_bytes()).unwrap();
}

fn claude_user(uuid: &str, content: Value, sidechain: bool) -> Value {
    json!({"type":"user","uuid":uuid,"isSidechain":sidechain,"timestamp":"2026-11-01T10:00:00.000Z",
        "message":{"role":"user","content":content}})
}

fn claude_reply(uuid: &str, model: &str, sidechain: bool) -> Value {
    json!({"type":"assistant","uuid":uuid,"isSidechain":sidechain,"timestamp":"2026-11-01T10:00:01.000Z",
        "message":{"model":model,"role":"assistant","content":[{"type":"text","text":"Done."}]}})
}

fn switch_line(uuid: &str, name: &str) -> Value {
    claude_user(
        uuid,
        json!(format!("<local-command-stdout>Set model to `{name}` and saved as your default for new sessions</local-command-stdout>")),
        false,
    )
}

/// A Claude log in a temp folder, with `v` as its lines.
fn claude_log(dir: &Path, v: &[Value]) -> PathBuf {
    let p = dir.join(".claude/projects/-home-sam-project/s1.jsonl");
    write(&p, &lines(v));
    p
}

#[test]
fn claude_latest_reply_wins() {
    let dir = tempfile::tempdir().unwrap();
    let log = claude_log(
        dir.path(),
        &[
            claude_user("u1", json!("hi"), false),
            claude_reply("a1", "claude-sonnet-5-5", false),
            claude_user("u2", json!("again"), false),
            claude_reply("a2", "claude-opus-5-5", false),
            claude_user("u3", json!("thanks"), false),
        ],
    );
    assert_eq!(model::current(log.to_str().unwrap()).as_deref(), Some("claude-opus-5-5"));
}

#[test]
fn claude_model_switch_shows_before_the_next_reply() {
    let dir = tempfile::tempdir().unwrap();
    let log = claude_log(
        dir.path(),
        &[
            claude_reply("a1", "claude-opus-5-5", false),
            claude_user("c1", json!("<command-name>/model</command-name>\n<command-args>sonnet</command-args>"), false),
            switch_line("c2", "Sonnet 5.5"),
        ],
    );
    assert_eq!(model::current(log.to_str().unwrap()).as_deref(), Some("Sonnet 5.5"));
}

#[test]
fn claude_sidechain_and_synthetic_lines_do_not_count() {
    let dir = tempfile::tempdir().unwrap();
    let log = claude_log(
        dir.path(),
        &[
            claude_reply("a1", "claude-opus-5-5", false),
            claude_reply("s1", "claude-haiku-5-5", true),
            claude_reply("a2", "<synthetic>", false),
            switch_line("s2", "Fable 5.2").as_object().cloned().map(|mut o| {
                o.insert("isSidechain".into(), json!(true));
                Value::Object(o)
            }).unwrap(),
        ],
    );
    assert_eq!(model::current(log.to_str().unwrap()).as_deref(), Some("claude-opus-5-5"));
}

#[test]
fn claude_log_with_no_reply_has_no_model() {
    let dir = tempfile::tempdir().unwrap();
    let log = claude_log(dir.path(), &[claude_user("u1", json!("hi"), false)]);
    assert_eq!(model::current(log.to_str().unwrap()), None);
    assert_eq!(model::current(dir.path().join("missing.jsonl").to_str().unwrap()), None);
}

#[test]
fn claude_model_switch_text_forms() {
    assert_eq!(switched_model("<local-command-stdout>Set model to `Opus 5.5` and saved as your default for new sessions</local-command-stdout>").as_deref(), Some("Opus 5.5"));
    assert_eq!(switched_model("<local-command-stdout>Kept model as `Opus 5.5`</local-command-stdout>").as_deref(), Some("Opus 5.5"));
    // An older form: ANSI bold and the id in parentheses.
    assert_eq!(
        switched_model("<local-command-stdout>Set model to \u{1b}[1mOpus 4.5 (claude-opus-4-5-20251101)\u{1b}[22m</local-command-stdout>").as_deref(),
        Some("claude-opus-4-5-20251101")
    );
    assert_eq!(switched_model("<local-command-stdout>Set model to Default (recommended)</local-command-stdout>").as_deref(), Some("Default (recommended)"));
    assert_eq!(switched_model("<local-command-stdout>Model is unchanged</local-command-stdout>"), None);
}

#[test]
fn a_tool_result_that_quotes_model_text_does_not_count() {
    // Tool output with "Set model to" (a grep of logs) is not `/model` output.
    let line = claude_user("t1", json!([{"type":"tool_result","tool_use_id":"x","content":"<local-command-stdout>Set model to `Haiku 5.5`"}]), false);
    assert_eq!(line_model(Agent::Claude, &line.to_string()), None);
}

#[test]
fn codex_turn_context_gives_the_model() {
    let dir = tempfile::tempdir().unwrap();
    let log = codex::sessions_root(dir.path()).join("2026/11/01/rollout-s1.jsonl");
    write(
        &log,
        &lines(&[
            json!({"type":"session_meta","payload":{"id":"s1","cwd":CWD}}),
            json!({"type":"turn_context","payload":{"cwd":CWD,"model":"gpt-5.4"}}),
            json!({"type":"turn_context","payload":{"cwd":CWD,"model":"gpt-5.5"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}),
        ]),
    );
    assert_eq!(model::current(log.to_str().unwrap()).as_deref(), Some("gpt-5.5"));
}

#[test]
fn pi_model_change_and_assistant_messages_give_the_model() {
    let dir = tempfile::tempdir().unwrap();
    let log = pi::project_dir(dir.path(), CWD).join("2026-11-01T10-00-00-000Z_s.jsonl");
    write(
        &log,
        &lines(&[
            json!({"type":"session","version":3,"id":"s","cwd":CWD}),
            json!({"type":"model_change","id":"m1","provider":"openai","modelId":"gpt-5.4"}),
            json!({"type":"message","id":"a1","message":{"role":"assistant","provider":"openai","model":"gpt-5.4","content":[]}}),
        ]),
    );
    let path = log.to_str().unwrap();
    assert_eq!(model::current(path).as_deref(), Some("gpt-5.4"));
    append(&log, &[json!({"type":"model_change","id":"m2","provider":"openai","modelId":"gpt-5.5"})]);
    assert_eq!(model::current(path).as_deref(), Some("gpt-5.5"));
}

#[test]
fn gemini_message_model_counts() {
    let line = json!({"id":"g1","type":"gemini","content":"ok","model":"gemini-3-pro"}).to_string();
    assert_eq!(line_model(Agent::Gemini, &line).as_deref(), Some("gemini-3-pro"));
    let user = json!({"id":"u1","type":"user","content":"hi","model":"x"}).to_string();
    assert_eq!(line_model(Agent::Gemini, &user), None);
}

#[test]
fn opencode_newest_assistant_row_gives_the_model() {
    let dir = tempfile::tempdir().unwrap();
    let db = opencode::db_path(dir.path());
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    let c = Connection::open(&db).unwrap();
    c.execute_batch(
        "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
           seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
    )
    .unwrap();
    let add = |seq: i64, kind: &str, data: Value| {
        c.execute(
            "INSERT INTO session_message VALUES (?1, 's', ?2, ?3, 0, 0, ?4)",
            params![format!("m{seq}"), kind, seq, data.to_string()],
        )
        .unwrap();
    };
    let log = opencode::log_path(&db, "s");
    assert_eq!(model::current(&log), None);
    add(0, "user", json!({"text":"hi"}));
    add(1, "assistant", json!({"model":{"providerID":"p","id":"model-a"},"content":[]}));
    add(2, "assistant", json!({"model":{"providerID":"p","id":"model-b"},"content":[]}));
    assert_eq!(model::current(&log).as_deref(), Some("model-b"));
}

#[test]
fn watch_reads_only_new_lines_and_sends_changes() {
    let dir = tempfile::tempdir().unwrap();
    let log = claude_log(dir.path(), &[claude_reply("a1", "claude-opus-5-5", false)]);
    let path = log.to_str().unwrap();
    let len = |p: &Path| std::fs::metadata(p).unwrap().len();
    let mut w = ModelWatch::new(path, len(&log));
    // Nothing new: nothing to send.
    assert_eq!(w.poll(len(&log)), None);
    append(&log, &[claude_user("u1", json!("hi"), false)]);
    assert_eq!(w.poll(len(&log)), None);
    append(&log, &[claude_reply("a2", "claude-opus-5-5", false)]);
    // The first signal after the start goes out once.
    assert_eq!(w.poll(len(&log)).as_deref(), Some("claude-opus-5-5"));
    append(&log, &[claude_reply("a3", "claude-opus-5-5", false)]);
    assert_eq!(w.poll(len(&log)), None);
    append(&log, &[switch_line("c1", "Sonnet 5.5")]);
    assert_eq!(w.poll(len(&log)).as_deref(), Some("Sonnet 5.5"));
    append(&log, &[claude_reply("s1", "claude-haiku-5-5", true)]);
    assert_eq!(w.poll(len(&log)), None);
}

#[test]
fn a_long_tail_without_a_signal_stops_at_the_scan_cap() {
    let dir = tempfile::tempdir().unwrap();
    let filler = "x".repeat(60 * 1024);
    let mut v = vec![claude_reply("a1", "claude-opus-5-5", false)];
    let n = (model::SCAN_CAP / (60 * 1024)) as usize + 4;
    v.extend((0..n).map(|i| claude_user(&format!("u{i}"), json!(filler), false)));
    let log = claude_log(dir.path(), &v);
    assert_eq!(model::current(log.to_str().unwrap()), None);
    append(&log, &[claude_reply("a2", "claude-fable-5-2", false)]);
    assert_eq!(model::current(log.to_str().unwrap()).as_deref(), Some("claude-fable-5-2"));
}
