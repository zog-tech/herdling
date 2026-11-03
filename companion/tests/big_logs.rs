//! Benchmark of the hot log reads on a large synthetic Claude log (about 70 MB).
//! It is ignored by default. Run it with:
//! `cargo test -j 2 --release --test big_logs -- --ignored --nocapture`
//! Set `TMPDIR` to put the generated files on a disk with free space.

use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

use herdlingd::claude::background::ClaudeFeed;
use herdlingd::claude::{self, Follower};
use herdlingd::transcript::background::BackgroundLog;
use herdlingd::transcript::{self};
use serde_json::json;

const CWD: &str = "/home/sam/proj";
/// Turns of ordinary work in the main log. Each turn is about 2.3 KB.
const TURNS: usize = 20_000;
/// Size of one base64 image line.
const IMAGE_BYTES: usize = 6 * 1024 * 1024;
/// Projects with a small log for `recent_cwds`.
const PROJECTS: usize = 120;

fn ts(i: usize) -> String {
    format!("2026-10-01T{:02}:{:02}:{:02}.000Z", (i / 3600) % 24, (i / 60) % 60, i % 60)
}

fn base(kind: &str, uuid: String, i: usize) -> serde_json::Value {
    json!({"parentUuid":null,"isSidechain":false,"userType":"external","cwd":CWD,"sessionId":"big","version":"2.1.0",
        "type":kind,"uuid":uuid,"timestamp":ts(i)})
}

fn image_line(uuid: &str, i: usize) -> String {
    let data = "A".repeat(IMAGE_BYTES);
    let mut v = base("user", uuid.to_string(), i);
    v["message"] = json!({"role":"user","content":[
        {"type":"image","source":{"type":"base64","media_type":"image/png","data":data}},
        {"type":"text","text":"What is wrong in this screenshot?"}]});
    format!("{v}\n")
}

fn turn(w: &mut impl Write, i: usize) {
    let filler = "x".repeat(1500);
    let mut u = base("user", format!("u{i}"), i);
    u["message"] = json!({"role":"user","content":format!("Step {i}: look at the file")});
    let mut a = base("assistant", format!("a{i}"), i);
    a["message"] = json!({"role":"assistant","content":[{"type":"tool_use","id":format!("toolu_{i}"),"name":"Read","input":{"file_path":format!("/home/sam/proj/f{i}.rs")}}]});
    let mut r = base("user", format!("r{i}"), i);
    r["message"] = json!({"role":"user","content":[{"type":"tool_result","tool_use_id":format!("toolu_{i}"),"content":filler}]});
    let mut t = base("assistant", format!("t{i}"), i);
    t["message"] = json!({"role":"assistant","content":[{"type":"text","text":format!("Done with step {i}.")}]});
    for v in [u, a, r, t] {
        writeln!(w, "{v}").unwrap();
    }
}

fn subagent_lines(w: &mut impl Write) {
    let mut a = base("assistant", "sub-call".into(), 1);
    a["message"] = json!({"role":"assistant","content":[{"type":"tool_use","id":"toolu_agent","name":"Agent","input":{"description":"Check the tests","prompt":"Check","subagent_type":"general-purpose"}}]});
    let mut r = base("user", "sub-launch".into(), 1);
    r["message"] = json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_agent","content":[{"type":"text","text":"Async agent launched successfully."}]}]});
    r["toolUseResult"] = json!({"isAsync":true,"status":"async_launched","agentId":"bench1","description":"Check the tests"});
    let mut b = base("assistant", "bg-call".into(), 1);
    b["message"] = json!({"role":"assistant","content":[{"type":"tool_use","id":"toolu_bg","name":"Bash","input":{"command":"pnpm dev","run_in_background":true}}]});
    let mut br = base("user", "bg-result".into(), 1);
    br["message"] = json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_bg","content":"Command running in background with ID: bg1"}]});
    br["toolUseResult"] = json!({"backgroundTaskId":"bg1"});
    for v in [a, r, b, br] {
        writeln!(w, "{v}").unwrap();
    }
}

/// Writes the main log, its subagent transcript, and small logs of other projects.
fn generate(home: &Path) -> (std::path::PathBuf, u64) {
    let dir = claude::project_dir(home, CWD);
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("big.jsonl");
    let mut w = std::io::BufWriter::new(std::fs::File::create(&log).unwrap());
    // The first prompt holds an image: `sessions.recent` reads it.
    w.write_all(image_line("first", 0).as_bytes()).unwrap();
    for i in 0..TURNS / 2 {
        turn(&mut w, i);
    }
    w.write_all(image_line("mid", 1).as_bytes()).unwrap();
    w.flush().unwrap();
    let mid_end = w.get_ref().metadata().unwrap().len();
    for i in TURNS / 2..TURNS {
        turn(&mut w, i);
    }
    // The subagent and the background shell sit on the last page.
    subagent_lines(&mut w);
    w.write_all(image_line("last", 2).as_bytes()).unwrap();
    for i in TURNS..TURNS + 5 {
        turn(&mut w, i);
    }
    w.flush().unwrap();

    let sub = log.with_extension("").join("subagents");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("agent-bench1.meta.json"), r#"{"agentType":"general-purpose","toolUseId":"toolu_agent"}"#).unwrap();
    let mut s = std::io::BufWriter::new(std::fs::File::create(sub.join("agent-bench1.jsonl")).unwrap());
    for i in 0..4000 {
        turn(&mut s, i);
    }
    s.flush().unwrap();

    // Other projects: a log that ends with large lines.
    for p in 0..PROJECTS {
        let d = claude::project_dir(home, &format!("/home/sam/p{p}"));
        std::fs::create_dir_all(&d).unwrap();
        let mut f = std::io::BufWriter::new(std::fs::File::create(d.join("s.jsonl")).unwrap());
        for i in 0..12 {
            let mut v = base("user", format!("p{p}-{i}"), i);
            v["cwd"] = json!(format!("/home/sam/p{p}"));
            v["message"] = json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"y".repeat(40_000)}]});
            writeln!(f, "{v}").unwrap();
        }
        f.flush().unwrap();
    }
    (log, mid_end)
}

fn time<T>(label: &str, runs: u32, mut f: impl FnMut() -> T) -> T {
    let mut out = None;
    let mut best = Duration::MAX;
    let start = Instant::now();
    for _ in 0..runs {
        let t = Instant::now();
        out = Some(f());
        best = best.min(t.elapsed());
    }
    let avg = start.elapsed() / runs;
    eprintln!("{label:<44} best {:>9.2} ms   avg {:>9.2} ms", best.as_secs_f64() * 1e3, avg.as_secs_f64() * 1e3);
    out.unwrap()
}

fn peak_rss_mb() -> f64 {
    let mut u: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut u) };
    let raw = u.ru_maxrss as f64;
    // macOS reports bytes, Linux reports KiB.
    if cfg!(target_os = "macos") { raw / 1048576.0 } else { raw / 1024.0 }
}

#[test]
#[ignore]
fn big_log_hot_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path();
    let (log, mid_end) = generate(home);
    let len = std::fs::metadata(&log).unwrap().len();
    eprintln!("main log: {:.1} MB", len as f64 / 1048576.0);
    eprintln!("peak RSS after generate: {:.0} MB", peak_rss_mb());

    let page = time("thread.get last page (60 items)", 5, || claude::thread_get(&log, None, 60).unwrap());
    assert!(!page.items.is_empty());
    let mut cursor = page.cursor;
    time("thread.get 20 older pages", 1, || {
        for _ in 0..20 {
            let p = claude::thread_get(&log, cursor, 60).unwrap();
            cursor = p.cursor;
        }
    });
    time("thread.get page at the middle image", 3, || {
        let mid = claude::thread_get(&log, Some(mid_end), 60).unwrap();
        assert!(!mid.items.is_empty());
    });
    let s_log = log.to_string_lossy().into_owned();
    time("thread.follow start + poll (+1 turn)", 3, || {
        let mut f = Follower::new(&log, len);
        f.poll().unwrap()
    });
    time("agents.preview read_log", 10, || herdlingd::preview::read_log(&log).unwrap());
    time("background first read (8 MB window)", 3, || {
        let mut b = BackgroundLog::<ClaudeFeed>::new(&log);
        b.update().unwrap();
        b.tracker.is_empty()
    });
    time("sessions.recent claude (20)", 5, || transcript::recent_sessions(home, "claude", CWD, 20));
    time("fs.dirs recent_cwds (30)", 3, || transcript::recent_cwds(home, 30));
    time("transcript::thread_get (dispatch)", 3, || transcript::thread_get(&s_log, None, 60).unwrap());
    eprintln!("peak RSS: {:.0} MB", peak_rss_mb());
}
