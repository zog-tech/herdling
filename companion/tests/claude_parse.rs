use std::cell::Cell;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::rc::Rc;

use serde_json::json;
use zogsshd::claude::{assemble, parse_line, parse_results, thread_get, thread_get_from};
use zogsshd::types::{ThreadItem, ToolResult};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn all_items(name: &str) -> Vec<ThreadItem> {
    let text = std::fs::read_to_string(fixture(name)).unwrap();
    let mut results = HashMap::new();
    let mut items = Vec::new();
    for l in text.lines() {
        results.extend(parse_results(l));
        items.extend(parse_line(l));
    }
    assemble(items, results)
}

fn id_of(i: &ThreadItem) -> String {
    match i {
        ThreadItem::User { id, .. }
        | ThreadItem::Assistant { id, .. }
        | ThreadItem::Thinking { id, .. }
        | ThreadItem::Tool { id, .. }
        | ThreadItem::Subagent { id, .. }
        | ThreadItem::System { id, .. } => id.clone(),
    }
}

#[test]
fn parses_user_and_assistant_text() {
    let items = all_items("claude_basic.jsonl");
    match &items[0] {
        ThreadItem::User { id, ts, text, images } => {
            assert_eq!(id, "u-0001:0");
            assert_eq!(*ts, 1772618401000); // 2026-03-04T10:00:01Z
            assert_eq!(text, "Add a retry to the fetch helper");
            assert!(images.is_none());
        }
        other => panic!("{other:?}"),
    }
    let a = items.iter().find(|i| matches!(i, ThreadItem::Assistant { .. })).unwrap();
    match a {
        ThreadItem::Assistant { id, markdown, .. } => {
            assert_eq!(id, "a-0002:0");
            assert_eq!(markdown, "I will read the helper first.");
        }
        _ => unreachable!(),
    }
}

#[test]
fn empty_thinking_is_redacted_marker() {
    let items = all_items("claude_basic.jsonl");
    assert!(items.iter().any(|i| matches!(i, ThreadItem::Thinking { text: None, .. })));
    let l = r#"{"type":"assistant","uuid":"x","timestamp":"2026-03-04T10:00:02.000Z","message":{"content":[{"type":"thinking","thinking":"hmm"}]}}"#;
    assert!(matches!(&parse_line(l)[0], ThreadItem::Thinking { text: Some(t), .. } if t == "hmm"));
}

#[test]
fn tool_use_gets_result_attached() {
    let items = all_items("claude_basic.jsonl");
    let read = items.iter().find(|i| id_of(i) == "toolu_read1").unwrap();
    match read {
        ThreadItem::Tool { name, input_summary, result: Some(r), .. } => {
            assert_eq!(name, "Read");
            assert_eq!(input_summary, "/home/sam/proj/src/fetch.ts");
            assert!(r.ok && !r.truncated);
            assert!(r.text.starts_with("export async"));
        }
        other => panic!("{other:?}"),
    }
    let bash = items.iter().find(|i| id_of(i) == "toolu_bash1").unwrap();
    match bash {
        ThreadItem::Tool { input_summary, result: Some(r), .. } => {
            assert_eq!(input_summary, "pnpm test");
            assert!(!r.ok);
            assert!(r.text.contains("2 tests failed"));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn tool_result_truncated_at_4096() {
    let items = all_items("claude_basic.jsonl");
    match items.iter().find(|i| id_of(i) == "toolu_big1").unwrap() {
        ThreadItem::Tool { result: Some(r), .. } => {
            assert!(r.truncated);
            assert!(r.text.len() <= 4096);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn task_tool_becomes_subagent() {
    let items = all_items("claude_basic.jsonl");
    match items.iter().find(|i| id_of(i) == "toolu_task1").unwrap() {
        ThreadItem::Subagent { description, status, result_summary, .. } => {
            assert_eq!(description, "Survey the test suite");
            assert_eq!(status, "done");
            assert_eq!(result_summary.as_deref(), Some("Found 12 tests."));
        }
        other => panic!("{other:?}"),
    }
    // Subagent log parses as ordinary items.
    let sub = all_items("claude_subagent.jsonl");
    assert_eq!(sub.len(), 3);
    assert!(matches!(&sub[1], ThreadItem::Tool { name, input_summary, result: Some(_), .. } if name == "Glob" && input_summary == "**/*.test.ts"));
}

#[test]
fn skips_blob_and_meta_lines() {
    let text = std::fs::read_to_string(fixture("claude_basic.jsonl")).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert!(parse_line(lines[0]).is_empty()); // file-history-snapshot
    assert!(parse_line(lines[1]).is_empty()); // api-request-blob
    assert!(parse_line(lines[3]).is_empty()); // isMeta
    assert!(parse_line("not json").is_empty());
    let items = all_items("claude_basic.jsonl");
    // turn_duration is skipped; the compaction summary is a system item.
    let sys: Vec<_> = items.iter().filter(|i| matches!(i, ThreadItem::System { .. })).collect();
    assert_eq!(sys.len(), 1);
    assert!(matches!(sys[0], ThreadItem::System { text, .. } if text.starts_with("Conversation compacted")));
}

#[test]
fn assemble_leaves_unmatched_tools_alone() {
    let l = r#"{"type":"assistant","uuid":"x","timestamp":"2026-03-04T10:00:02.000Z","message":{"content":[{"type":"tool_use","id":"t1","name":"Foo","input":{"a":1,"b":"hello"}}]}}"#;
    let out = assemble(parse_line(l), HashMap::from([("other".to_string(), ToolResult { ok: true, text: "x".into(), truncated: false })]));
    assert!(matches!(&out[0], ThreadItem::Tool { input_summary, result: None, .. } if input_summary == "hello"));
}

#[test]
fn paging_returns_cursor_and_older_page() {
    let p = fixture("claude_basic.jsonl");
    let total = all_items("claude_basic.jsonl").len();
    let first = thread_get(&p, None, 2).unwrap();
    assert!(first.cursor.is_some());
    assert_eq!(first.end, std::fs::metadata(&p).unwrap().len());
    let second = thread_get(&p, first.cursor, 2).unwrap();
    assert!(!second.items.is_empty());
    let a: Vec<String> = first.items.iter().map(id_of).collect();
    let b: Vec<String> = second.items.iter().map(id_of).collect();
    assert!(a.iter().all(|x| !b.contains(x)), "overlap {a:?} {b:?}");
    // Walk to the start: every item exactly once, in order.
    let mut cur = first.cursor;
    let mut ids = a;
    while let Some(c) = cur {
        let pg = thread_get(&p, Some(c), 2).unwrap();
        let mut older: Vec<String> = pg.items.iter().map(id_of).collect();
        older.extend(ids);
        ids = older;
        cur = pg.cursor;
    }
    let want: Vec<String> = all_items("claude_basic.jsonl").iter().map(id_of).collect();
    assert_eq!(ids.len(), total);
    assert_eq!(ids, want);
}

#[test]
fn unterminated_last_line_is_left_for_next_read() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("s.jsonl");
    let full = r#"{"type":"user","uuid":"u1","timestamp":"2026-03-04T10:00:01.000Z","message":{"content":"hi"}}"#;
    std::fs::write(&p, format!("{full}\n{{\"type\":\"user\",\"uuid\":\"u2\",\"mess")).unwrap();
    let pg = thread_get(&p, None, 10).unwrap();
    assert_eq!(pg.items.len(), 1);
    assert_eq!(pg.end, full.len() as u64 + 1);
    assert!(pg.cursor.is_none());
}

struct Counting<R> {
    inner: R,
    bytes: Rc<Cell<u64>>,
}
impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.bytes.set(self.bytes.get() + n as u64);
        Ok(n)
    }
}
impl<R: Seek> Seek for Counting<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

#[test]
fn large_file_reads_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("big.jsonl");
    let mut f = std::io::BufWriter::new(std::fs::File::create(&p).unwrap());
    let pad = "p".repeat(900);
    let mut n = 0u64;
    while n < 60 * 1024 * 1024 {
        let line = json!({"type":"assistant","uuid":format!("a-{n}"),"timestamp":"2026-03-04T10:00:00.000Z",
            "message":{"content":[{"type":"text","text":pad}]}})
        .to_string();
        writeln!(f, "{line}").unwrap();
        n += line.len() as u64 + 1;
    }
    f.flush().unwrap();
    drop(f);
    let bytes = Rc::new(Cell::new(0));
    let r = Counting { inner: std::fs::File::open(&p).unwrap(), bytes: bytes.clone() };
    let page = thread_get_from(r, None, 60).unwrap();
    assert_eq!(page.items.len(), 60);
    assert!(page.cursor.is_some());
    assert!(bytes.get() < 2 * 1024 * 1024, "read {} bytes", bytes.get());
}
