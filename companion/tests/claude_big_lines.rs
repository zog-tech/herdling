//! Claude logs with very long lines (base64 images) and lines still being written.

use std::io::Write;
use std::path::Path;

use herdlingd::claude::background::ClaudeFeed;
use herdlingd::claude::{recent_sessions, thread_get, Follower};
use herdlingd::tail::LINE_CAP;
use herdlingd::transcript::background::BackgroundLog;
use herdlingd::types::ThreadItem;
use serde_json::json;

fn append(path: &Path, text: &str) {
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
    f.write_all(text.as_bytes()).unwrap();
}

fn user_line(uuid: &str, text: &str) -> String {
    format!("{}\n", json!({"type":"user","uuid":uuid,"cwd":"/home/sam/proj","message":{"role":"user","content":text}}))
}

/// A user line with an image larger than [`LINE_CAP`] and a short text.
fn image_line(uuid: &str, text: &str) -> String {
    let data = "A".repeat(LINE_CAP + 1000);
    format!(
        "{}\n",
        json!({"type":"user","uuid":uuid,"message":{"role":"user","content":[
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":data}},
            {"type":"text","text":text}]}})
    )
}

fn is_image_prompt(item: &ThreadItem, want: &str) -> bool {
    matches!(item, ThreadItem::User { text, images: Some(1), .. } if text == want)
}

#[test]
fn page_reads_a_huge_image_line() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &user_line("u0", "before"));
    append(&log, &image_line("u1", "look at this"));
    append(&log, &user_line("u2", "after"));
    let page = thread_get(&log, None, 60).unwrap();
    assert_eq!(page.items.len(), 3);
    assert!(is_image_prompt(&page.items[1], "look at this"));
    assert!(matches!(&page.items[2], ThreadItem::User { text, .. } if text == "after"));
}

#[test]
fn page_leaves_out_a_partial_huge_tail() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &user_line("u0", "done"));
    let end = std::fs::metadata(&log).unwrap().len();
    let line = image_line("u1", "still writing");
    append(&log, &line[..line.len() / 2]);
    let page = thread_get(&log, None, 60).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.end, end);
}

#[test]
fn follow_reads_a_huge_line_written_in_parts() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &user_line("u0", "old"));
    let from = std::fs::metadata(&log).unwrap().len();
    let mut f = Follower::new(&log, from);
    let line = image_line("u1", "big one");
    let (head, tail) = line.split_at(line.len() - 100);
    append(&log, head);
    assert!(f.poll().unwrap().is_none());
    append(&log, tail);
    append(&log, &user_line("u2", "small").replace('\n', "\r\n"));
    // The huge line passes the step size, so the small line comes in the next poll.
    let (mut items, _) = f.poll().unwrap().unwrap();
    let (more, offset) = f.poll().unwrap().unwrap();
    items.extend(more);
    assert_eq!(items.len(), 2);
    assert!(is_image_prompt(&items[0], "big one"));
    assert!(matches!(&items[1], ThreadItem::User { text, .. } if text == "small"));
    assert_eq!(offset, std::fs::metadata(&log).unwrap().len());
}

#[test]
fn background_scan_passes_a_huge_line() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &image_line("u0", "first"));
    append(
        &log,
        &format!(
            "{}\n",
            json!({"type":"assistant","uuid":"a1","timestamp":"2026-10-01T10:00:00.000Z","message":{"role":"assistant","content":[
                {"type":"tool_use","id":"toolu_bg","name":"Bash","input":{"command":"pnpm dev","run_in_background":true}}]}})
        ),
    );
    append(
        &log,
        &format!(
            "{}\n",
            json!({"type":"user","uuid":"u1","timestamp":"2026-10-01T10:00:01.000Z","message":{"role":"user","content":[
                {"type":"tool_result","tool_use_id":"toolu_bg","content":"Command running in background with ID: bg1"}]},
                "toolUseResult":{"backgroundTaskId":"bg1"}})
        ),
    );
    let mut b = BackgroundLog::<ClaudeFeed>::new(&log);
    b.update().unwrap();
    assert!(!b.tracker.is_empty());
}

#[test]
fn first_prompt_skips_past_a_huge_image_line() {
    let home = tempfile::tempdir().unwrap();
    let dir = herdlingd::claude::project_dir(home.path(), "/home/sam/proj");
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("sess.jsonl");
    append(&log, &image_line("u0", "what is this"));
    let got = recent_sessions(home.path(), "/home/sam/proj", 5);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].first_prompt, "what is this");
    // The cached prompt stays when the log grows.
    append(&log, &user_line("u1", "next"));
    assert_eq!(recent_sessions(home.path(), "/home/sam/proj", 5)[0].first_prompt, "what is this");
}
