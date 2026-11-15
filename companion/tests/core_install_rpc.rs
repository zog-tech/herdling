//! `core.status`, `core.install` and the core path of `herdr.update` through `rpc::run`, with a
//! fake process runner, a fake download and a fake socket probe. No test downloads or runs a core.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use herdlingd::core_install::pin::CorePin;
use herdlingd::core_install::CoreInstallCtx;
use herdlingd::herdr_update::{Exit, HerdrRunner, RunOut};
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PIN: &str = "0.1.20";

fn ok(stdout: &str) -> RunOut {
    RunOut { exit: Exit::Exited { success: true, code: Some(0) }, stdout: stdout.into(), stderr: String::new() }
}

/// `--version` gives `installed` for the core in `~/.local/bin` and the pin for a staged core.
/// `update --from` makes the installed core the pin. Every other call succeeds.
struct FakeCore {
    installed: Mutex<Option<String>>,
    calls: Mutex<Vec<Vec<String>>>,
}

impl HerdrRunner for FakeCore {
    fn run(&self, bin: &Path, args: &[&str], _env: &[(OsString, OsString)], _t: Duration) -> RunOut {
        self.calls.lock().unwrap().push(args.iter().map(|a| a.to_string()).collect());
        let staged = bin.to_string_lossy().contains("/.cache/herdling/core.");
        match args {
            ["--version"] if staged => ok(&format!("hc {PIN}")),
            ["--version"] => ok(&format!("hc {}", self.installed.lock().unwrap().clone().unwrap_or_default())),
            ["update", "--from", _] => {
                *self.installed.lock().unwrap() = Some(PIN.into());
                ok("")
            }
            _ => ok(""),
        }
    }
}

fn tarball(dir: &Path) -> Vec<u8> {
    let src = dir.join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("herdr-core"), "core").unwrap();
    let out = dir.join("core.tar.gz");
    assert!(std::process::Command::new("tar").arg("-czf").arg(&out).arg("-C").arg(&src).arg("herdr-core").status().unwrap().success());
    std::fs::read(out).unwrap()
}

struct Fix {
    _dir: tempfile::TempDir,
    core_ctx: CoreInstallCtx,
    core: Arc<FakeCore>,
    downloads: Arc<Mutex<usize>>,
}

/// `installed`: the version of a core in `~/.local/bin` (None: no core).
fn fix(installed: Option<&str>) -> Fix {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    if installed.is_some() {
        let bin = home.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("herdr-core"), "old").unwrap();
        std::fs::set_permissions(bin.join("herdr-core"), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let tar = tarball(dir.path());
    let pin = CorePin {
        version: PIN.into(),
        required: false,
        sha256: BTreeMap::from([("linux-x86_64".into(), herdlingd::update::sha256_hex(&tar))]),
    };
    let core = Arc::new(FakeCore { installed: Mutex::new(installed.map(String::from)), calls: Mutex::new(Vec::new()) });
    let downloads = Arc::new(Mutex::new(0));
    let d = downloads.clone();
    let running = Arc::new(AtomicBool::new(true));
    let core_ctx = CoreInstallCtx {
        home: home.clone(),
        dirs: vec![home.join(".local/bin")],
        env: vec![("PATH".into(), "/usr/bin".into())],
        runner: core.clone(),
        fetch: Arc::new(move |_url: &str| {
            *d.lock().unwrap() += 1;
            Ok(tar.clone())
        }),
        probe: Arc::new(move |_| running.load(Ordering::SeqCst).then(|| PIN.to_string())),
        mac: false,
        target: Some("linux-x86_64".into()),
        pin,
        lock_dir: home.join(".config/herdling"),
    };
    Fix { _dir: dir, core_ctx, core, downloads }
}

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn call(&mut self, id: u64, method: &str) -> Value {
        let line = json!({"id": id, "method": method, "params": {}}).to_string();
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        loop {
            let r: Value = serde_json::from_str(&self.rx.next_line().await.unwrap().unwrap()).unwrap();
            if r["id"] == id {
                return r;
            }
        }
    }
}

fn ctx_with(f: &Fix) -> Ctx {
    let mut ctx = Ctx::new(f.core_ctx.home.clone());
    ctx.core_install = Some(f.core_ctx.clone());
    ctx
}

#[tokio::test]
async fn the_methods_are_listed_and_off_without_a_context() {
    assert!(rpc::METHODS.contains(&"core.status"));
    assert!(rpc::METHODS.contains(&"core.install"));
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(Ctx::new(dir.path().into()));
    for (i, m) in ["core.status", "core.install"].iter().enumerate() {
        let r = s.call(i as u64 + 1, m).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
    }
}

#[tokio::test]
async fn core_status_reports_and_only_reads() {
    let f = fix(Some("0.1.19"));
    let mut s = Session::start(ctx_with(&f));
    let r = s.call(1, "core.status").await;
    let st = &r["result"];
    assert_eq!(st["found"], true, "{r}");
    assert_eq!(st["installed"], "0.1.19");
    assert_eq!(st["running"], true);
    assert_eq!(st["running_version"], PIN);
    assert_eq!(st["pinned"], PIN);
    assert_eq!(st["newer_than_pin"], false);
    assert_eq!(st["update_available"], true);
    assert_eq!(st["managed"], false);
    assert_eq!(st["target"], "linux-x86_64");
    assert_eq!(*f.downloads.lock().unwrap(), 0);
    assert_eq!(*f.core.calls.lock().unwrap(), vec![vec!["--version".to_string()]]);
}

#[tokio::test]
async fn core_install_updates_to_the_pin() {
    let f = fix(Some("0.1.19"));
    let mut s = Session::start(ctx_with(&f));
    let r = s.call(1, "core.install").await;
    assert_eq!(r["result"]["status"], "updated", "{r}");
    assert_eq!(r["result"]["from"], "0.1.19");
    assert_eq!(r["result"]["to"], PIN);
    assert_eq!(r["result"]["pinned"], PIN);
    assert_eq!(*f.downloads.lock().unwrap(), 1);
}

#[tokio::test]
async fn core_install_keeps_a_newer_core() {
    let f = fix(Some("0.2.4"));
    let mut s = Session::start(ctx_with(&f));
    let r = s.call(1, "core.install").await;
    assert_eq!(r["result"]["status"], "kept_newer", "{r}");
    assert_eq!(*f.downloads.lock().unwrap(), 0);
}

#[tokio::test]
async fn herdr_update_updates_the_core() {
    let f = fix(Some("0.1.19"));
    let mut s = Session::start(ctx_with(&f));
    let r = s.call(1, "herdr.update").await;
    let u = &r["result"];
    assert_eq!(u["status"], "updated", "{r}");
    assert_eq!(u["from"], "0.1.19");
    assert_eq!(u["to"], PIN);
    assert_eq!(u["handoff"], "complete");
    assert!(u["output"].as_str().unwrap().contains("herdr-core"));
    assert!(!f.core.calls.lock().unwrap().iter().any(|c| c == &["update", "--handoff"]), "no herdr 1 update");
}

#[tokio::test]
async fn herdr_update_without_an_install_context_is_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(Ctx::new(dir.path().into()));
    let r = s.call(1, "herdr.update").await;
    assert_eq!(r["error"]["code"], "update_unavailable", "{r}");
}
