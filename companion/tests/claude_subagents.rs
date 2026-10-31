use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::json;
use zogsshd::claude::subagents::{tool_activity, transcript_running, ACTIVITY_CAP};
use zogsshd::claude::{assemble, merge_result, parse_line, parse_results, thread_get, Follower, ResultKind};
use zogsshd::types::ThreadItem;

/// The exact tool result Claude Code writes when it launches a background subagent.
const LAUNCH: &str = "Async agent launched successfully. (This tool result is internal metadata \u{2014} never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: a1b2c3 (internal ID - do not mention to user. Use SendMessage with to: 'a1b2c3', summary: '<5-10 word recap>' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.";

fn append(path: &Path, text: &str) {
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
    f.write_all(text.as_bytes()).unwrap();
}

fn line(v: serde_json::Value) -> String {
    format!("{v}\n")
}

fn call(ts: Option<&str>) -> String {
    let mut v = json!({"type":"assistant","uuid":"a1","message":{"role":"assistant","content":[
        {"type":"tool_use","id":"toolu_task","name":"Agent","input":{"description":"Fix the parser","prompt":"Fix it","subagent_type":"general-purpose"}}]}});
    if let Some(ts) = ts {
        v["timestamp"] = json!(ts);
    }
    line(v)
}

fn launch_result() -> String {
    line(json!({"type":"user","uuid":"u2","timestamp":"2026-03-04T10:00:01.000Z",
        "message":{"role":"user","content":[{"tool_use_id":"toolu_task","type":"tool_result","content":[{"type":"text","text":LAUNCH}]}]},
        "toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a1b2c3","description":"Fix the parser"}}))
}

fn notification() -> String {
    let text = "<task-notification>\n<task-id>a1b2c3</task-id>\n<tool-use-id>toolu_task</tool-use-id>\n<status>completed</status>\n<summary>Agent \"Fix the parser\" finished</summary>\n<result>The parser is fixed. 3 tests added.</result>\n</task-notification>";
    line(json!({"type":"user","uuid":"u3","timestamp":"2026-03-04T10:05:00.000Z","message":{"role":"user","content":text}}))
}

fn sub_line(kind: &str, ts: &str, content: serde_json::Value) -> String {
    line(json!({"type":kind,"isSidechain":true,"agentId":"a1b2c3","uuid":format!("s-{ts}"),"timestamp":ts,
        "message":{"role":kind,"content":content}}))
}

/// Session dir with a parent log. Returns (dir guard, log path, subagents dir).
fn session() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("sess.jsonl");
    std::fs::write(&log, "").unwrap();
    let subs = dir.path().join("sess").join("subagents");
    std::fs::create_dir_all(&subs).unwrap();
    (dir, log, subs)
}

fn write_meta(subs: &Path, finished: Option<bool>) {
    let mut m = json!({"agentType":"general-purpose","isBuiltIn":true,"description":"Fix the parser","toolUseId":"toolu_task","spawnDepth":1,"requestShape":"background","model":"sonnet"});
    if let Some(f) = finished {
        m["finished"] = json!(f);
    }
    std::fs::write(subs.join("agent-a1b2c3.meta.json"), m.to_string()).unwrap();
}

fn write_transcript(subs: &Path) -> PathBuf {
    let p = subs.join("agent-a1b2c3.jsonl");
    append(&p, &sub_line("user", "2026-03-04T10:00:02.000Z", json!("Fix it")));
    append(&p, &sub_line("assistant", "2026-03-04T10:00:03.000Z", json!([{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"cargo test\n--all"}}])));
    append(&p, &sub_line("user", "2026-03-04T10:00:04.000Z", json!([{"tool_use_id":"t1","type":"tool_result","content":"\"type\":\"assistant\" in some output"}])));
    append(&p, &sub_line("assistant", "2026-03-04T10:00:05.000Z", json!([{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"/Users/sam/proj/src/parse.rs"}}])));
    p
}

struct Sub {
    agent_id: String,
    status: String,
    summary: Option<String>,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    activity: Option<String>,
    tool_count: Option<u32>,
    model: Option<String>,
}

fn sub(item: &ThreadItem) -> Sub {
    match item {
        ThreadItem::Subagent { agent_id, status, result_summary, started_at, finished_at, activity, tool_count, model, .. } => Sub {
            agent_id: agent_id.clone(),
            status: status.clone(),
            summary: result_summary.clone(),
            started_at: *started_at,
            finished_at: *finished_at,
            activity: activity.clone(),
            tool_count: *tool_count,
            model: model.clone(),
        },
        other => panic!("not a subagent: {other:?}"),
    }
}

fn only_sub(items: &[ThreadItem]) -> Sub {
    let subs: Vec<&ThreadItem> = items.iter().filter(|i| matches!(i, ThreadItem::Subagent { .. })).collect();
    assert_eq!(subs.len(), 1, "{items:?}");
    sub(subs[0])
}

const T3: i64 = 1_772_618_403_000; // 2026-03-04T10:00:03Z
const T2: i64 = T3 - 1000;
const T5: i64 = T3 + 2000;

#[test]
fn launch_text_is_never_a_summary() {
    let res = parse_results(&launch_result());
    assert_eq!(res.len(), 1);
    assert_eq!(res[0].1.kind, ResultKind::Launch);
    assert_eq!(res[0].1.result.text, "");
    let out = assemble(parse_line(&call(None)), res.into_iter().collect());
    let s = sub(&out[0]);
    assert_eq!(s.status, "running");
    assert_eq!(s.summary, None);
    assert_eq!(s.agent_id, "a1b2c3");
    // The text alone, without `toolUseResult`, is a launch too.
    let bare = line(json!({"type":"user","uuid":"u2","message":{"role":"user","content":[{"tool_use_id":"toolu_task","type":"tool_result","content":LAUNCH}]}}));
    assert_eq!(parse_results(&bare)[0].1.kind, ResultKind::Launch);
}

#[test]
fn a_launch_never_hides_the_notification() {
    let mut map = HashMap::new();
    // Read newest first, as a backward page does.
    for (id, info) in parse_results(&notification()).into_iter().chain(parse_results(&launch_result())) {
        merge_result(&mut map, id, info);
    }
    let r = &map["toolu_task"];
    assert_eq!(r.kind, ResultKind::Notice);
    assert_eq!(r.result.text, "The parser is fixed. 3 tests added.");
    assert_eq!(r.agent_id.as_deref(), Some("a1b2c3"));
}

#[test]
fn notification_completes_a_background_subagent_in_a_page() {
    let (_d, log, _subs) = session();
    append(&log, &call(Some("2026-03-04T10:00:00.000Z")));
    append(&log, &launch_result());
    append(&log, &notification());
    for limit in [1, 60] {
        let mut cur = None;
        let mut items = Vec::new();
        loop {
            let pg = thread_get(&log, cur, limit).unwrap();
            let mut older = pg.items;
            older.extend(items);
            items = older;
            cur = pg.cursor;
            if cur.is_none() {
                break;
            }
        }
        let s = only_sub(&items);
        assert_eq!(s.status, "completed", "limit {limit}");
        assert_eq!(s.summary.as_deref(), Some("The parser is fixed. 3 tests added."));
        assert_eq!(s.agent_id, "a1b2c3");
        assert_eq!(s.finished_at, Some(T3 - 3000 + 300_000));
    }
}

#[test]
fn notification_does_not_replace_a_bash_result() {
    let call = line(json!({"type":"assistant","uuid":"a1","message":{"role":"assistant","content":[
        {"type":"tool_use","id":"toolu_task","name":"Bash","input":{"command":"sleep 9","run_in_background":true}}]}}));
    let res = line(json!({"type":"user","uuid":"u2","message":{"role":"user","content":[{"tool_use_id":"toolu_task","type":"tool_result","content":"Command running in background"}]}}));
    // Only the notice: the tool stays without a result.
    let only_notice: HashMap<_, _> = parse_results(&notification()).into_iter().collect();
    match &assemble(parse_line(&call), only_notice)[0] {
        ThreadItem::Tool { result, .. } => assert!(result.is_none()),
        other => panic!("{other:?}"),
    }
    let (_d, log, _subs) = session();
    append(&log, &call);
    append(&log, &res);
    append(&log, &notification());
    let pg = thread_get(&log, None, 60).unwrap();
    match pg.items.iter().find(|i| matches!(i, ThreadItem::Tool { .. })).unwrap() {
        ThreadItem::Tool { result: Some(r), .. } => assert_eq!(r.text, "Command running in background"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn meta_resolves_a_running_subagent_with_activity() {
    let (_d, log, subs) = session();
    append(&log, &call(None));
    write_meta(&subs, None);
    write_transcript(&subs);
    let s = only_sub(&thread_get(&log, None, 60).unwrap().items);
    assert_eq!(s.agent_id, "a1b2c3");
    assert_eq!(s.status, "running");
    assert_eq!(s.summary, None);
    assert_eq!(s.started_at, Some(T2));
    assert_eq!(s.tool_count, Some(2));
    assert_eq!(s.activity.as_deref(), Some("Read parse.rs"));
    assert_eq!(s.model.as_deref(), Some("sonnet"));
    assert_eq!(s.finished_at, None);
}

#[test]
fn finished_meta_ends_the_subagent_with_its_last_text() {
    let (_d, log, subs) = session();
    append(&log, &call(None));
    append(&log, &launch_result());
    write_meta(&subs, Some(true));
    let p = write_transcript(&subs);
    append(&p, &sub_line("assistant", "2026-03-04T10:00:07.000Z", json!([{"type":"text","text":"## Done\nAll tests pass."}])));
    let s = only_sub(&thread_get(&log, None, 60).unwrap().items);
    assert_eq!(s.status, "done");
    assert_eq!(s.summary.as_deref(), Some("## Done\nAll tests pass."));
    assert_eq!(s.finished_at, Some(T5 + 2000));
    assert_eq!(s.activity, None);
    assert_eq!(s.tool_count, Some(2));
}

#[test]
fn missing_meta_keeps_running_then_goes_stale() {
    let (_d, log, _subs) = session();
    append(&log, &call(None));
    let s = only_sub(&thread_get(&log, None, 60).unwrap().items);
    assert_eq!(s.status, "running");
    assert_eq!(s.agent_id, "");
    assert_eq!(s.tool_count, None);

    // An old call with no transcript and no result stopped long ago.
    let (_d2, old, _s2) = session();
    append(&old, &call(Some("2026-03-04T10:00:00.000Z")));
    let s = only_sub(&thread_get(&old, None, 60).unwrap().items);
    assert_eq!(s.status, "stopped");
    assert_eq!(s.activity, None);
}

#[test]
fn follower_sends_progress_of_a_running_subagent() {
    let (_d, log, subs) = session();
    let mut f = Follower::new(&log, 0);
    append(&log, &call(None));
    append(&log, &launch_result());
    let (items, _) = f.poll().unwrap().unwrap();
    let s = only_sub(&items);
    assert_eq!(s.status, "running");
    assert_eq!(s.summary, None, "the launch text must not show");
    assert_eq!(s.agent_id, "a1b2c3");
    assert!(f.poll_agents().is_empty(), "nothing changed yet");

    write_meta(&subs, None);
    let p = write_transcript(&subs);
    let s = only_sub(&f.poll_agents());
    assert_eq!(s.activity.as_deref(), Some("Read parse.rs"));
    assert_eq!(s.tool_count, Some(2));
    assert!(f.poll_agents().is_empty(), "no change, no item");

    append(&p, &sub_line("assistant", "2026-03-04T10:00:06.000Z", json!([{"type":"tool_use","id":"t3","name":"Edit","input":{"file_path":"/Users/sam/proj/src/lib.rs"}}])));
    let s = only_sub(&f.poll_agents());
    assert_eq!(s.activity.as_deref(), Some("Edit lib.rs"));
    assert_eq!(s.tool_count, Some(3));

    append(&p, &sub_line("assistant", "2026-03-04T10:00:07.000Z", json!([{"type":"text","text":"Fixed."}])));
    write_meta(&subs, Some(true));
    let s = only_sub(&f.poll_agents());
    assert_eq!(s.status, "done");
    assert_eq!(s.summary.as_deref(), Some("Fixed."));
    assert!(f.poll_agents().is_empty(), "a done subagent is not checked again");

    // The notification comes later and gives the final summary.
    append(&log, &notification());
    let (items, _) = f.poll().unwrap().unwrap();
    let s = only_sub(&items);
    assert_eq!(s.status, "completed");
    assert_eq!(s.summary.as_deref(), Some("The parser is fixed. 3 tests added."));
    assert_eq!(s.tool_count, Some(3));
}

#[test]
fn follower_seeded_after_launch_still_tracks_the_subagent() {
    let (_d, log, subs) = session();
    append(&log, &call(None));
    append(&log, &launch_result());
    write_meta(&subs, None);
    write_transcript(&subs);
    let end = std::fs::metadata(&log).unwrap().len();
    let mut f = Follower::new(&log, end);
    append(&subs.join("agent-a1b2c3.jsonl"), &sub_line("assistant", "2026-03-04T10:00:06.000Z", json!([{"type":"tool_use","id":"t3","name":"Grep","input":{"pattern":"fn main"}}])));
    let s = only_sub(&f.poll_agents());
    assert_eq!(s.activity.as_deref(), Some("Grep fn main"));
    append(&log, &notification());
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(only_sub(&items).status, "completed");
}

#[test]
fn activity_is_short() {
    assert_eq!(tool_activity("Bash", &json!({"command":"cargo test\n--all"}), "x"), "Bash cargo test");
    assert_eq!(tool_activity("Write", &json!({"file_path":"/Users/sam/a/b.ts"}), "x"), "Write b.ts");
    assert_eq!(tool_activity("WebFetch", &json!({"url":"https://example.com"}), "https://example.com"), "WebFetch https://example.com");
    let long = tool_activity("Bash", &json!({"command":"x".repeat(300)}), "");
    assert_eq!(long.chars().count(), ACTIVITY_CAP);
    assert!(long.ends_with('…'));
}

#[test]
fn transcript_running_reads_the_meta() {
    let (_d, _log, subs) = session();
    let p = write_transcript(&subs);
    let now = SystemTime::now();
    assert_eq!(transcript_running(&p, now), None);
    write_meta(&subs, None);
    assert_eq!(transcript_running(&p, now), Some(true));
    // No write for an hour: stopped.
    assert_eq!(transcript_running(&p, now + std::time::Duration::from_secs(3600)), Some(false));
    write_meta(&subs, Some(true));
    assert_eq!(transcript_running(&p, now), Some(false));
}
