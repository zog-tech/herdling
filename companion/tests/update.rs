//! Self-update against a local fake release server. Never touches the real network.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;
use herdlingd::install::Runner;
use herdlingd::update::{self, UpdateCtx};
use serde_json::json;

/// Answers GET `/releases/<path>` from a map of path to body.
async fn file(State(files): State<Arc<HashMap<String, Vec<u8>>>>, UrlPath(path): UrlPath<String>) -> Result<Vec<u8>, StatusCode> {
    files.get(&path).cloned().ok_or(StatusCode::NOT_FOUND)
}

/// A `.tar.gz` that holds one `herdlingd` file with `content`.
fn tarball(dir: &Path, content: &str) -> Vec<u8> {
    let src = dir.join("pkg");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("herdlingd"), content).unwrap();
    let out = dir.join("pkg.tar.gz");
    let st = std::process::Command::new("tar").arg("-czf").arg(&out).arg("-C").arg(&src).arg("herdlingd").status().unwrap();
    assert!(st.success());
    std::fs::read(out).unwrap()
}

#[derive(Default)]
struct FakeRunner {
    calls: Mutex<Vec<Vec<String>>>,
}

impl Runner for FakeRunner {
    fn run(&self, cmd: &[String]) -> anyhow::Result<String> {
        self.calls.lock().unwrap().push(cmd.to_vec());
        Ok(String::new())
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    ctx: UpdateCtx,
    runner: Arc<FakeRunner>,
    exe: PathBuf,
}

const TARGET: &str = "x86_64-unknown-linux-musl";
const OLD: &str = "#!/bin/sh\necho old\n";
const NEW: &str = "#!/bin/sh\necho new\n";

/// A release server with `version` whose asset has `sha` (None: the real checksum) and `url_base`
/// (None: the server). The running version is `current`.
async fn fixture(version: &str, current: &str, sha: Option<&str>, url_base: Option<&str>) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let tar = tarball(dir.path(), NEW);
    let real_sha = update::sha256_hex(&tar);
    let asset_path = format!("download/herdlingd-v{version}/herdlingd-{TARGET}.tar.gz");
    let mut files = HashMap::new();
    files.insert(asset_path.clone(), tar);
    let manifest = |base: &str| {
        let url = format!("{}/{asset_path}", url_base.unwrap_or(base));
        serde_json::to_vec(&json!({
            "version": version,
            "date": "2026-11-02",
            "notes": "Fixes.",
            "assets": { TARGET: { "url": url, "sha256": sha.unwrap_or(&real_sha) } }
        }))
        .unwrap()
    };
    // Bind first: the manifest URLs need the address of the server.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/releases", listener.local_addr().unwrap());
    files.insert("latest/download/latest.json".into(), manifest(&base));
    files.insert(format!("download/herdlingd-v{version}/latest.json"), manifest(&base));
    let app = Router::new().route("/releases/{*path}", get(file)).with_state(Arc::new(files));
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let home = dir.path().join("home");
    let bin = home.join(".local/bin");
    std::fs::create_dir_all(&bin).unwrap();
    let exe = bin.join("herdlingd");
    std::fs::write(&exe, OLD).unwrap();
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runner = Arc::new(FakeRunner::default());
    let ctx = UpdateCtx {
        release_base: base,
        exe: exe.clone(),
        home,
        os: "linux".into(),
        arch: "x86_64".into(),
        current: current.into(),
        runner: runner.clone(),
    };
    Fixture { _dir: dir, ctx, runner, exe }
}

fn bin_entries(f: &Fixture) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(f.exe.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn target_selection() {
    assert_eq!(update::asset_target("macos", "aarch64"), Some("aarch64-apple-darwin"));
    assert_eq!(update::asset_target("macos", "x86_64"), Some("x86_64-apple-darwin"));
    assert_eq!(update::asset_target("linux", "x86_64"), Some("x86_64-unknown-linux-musl"));
    assert_eq!(update::asset_target("linux", "aarch64"), Some("aarch64-unknown-linux-musl"));
    assert_eq!(update::asset_target("windows", "x86_64"), None);
    assert_eq!(update::asset_target("linux", "riscv64"), None);
}

#[test]
fn version_compare() {
    use update::compare_versions as c;
    assert_eq!(c("0.2.0", "0.1.9"), Some(Ordering::Greater));
    assert_eq!(c("0.10.0", "0.9.0"), Some(Ordering::Greater));
    assert_eq!(c("v1.0.0", "1.0.0"), Some(Ordering::Equal));
    assert_eq!(c("1.0.0-rc.1", "1.0.0"), Some(Ordering::Less));
    assert_eq!(c("1.0.0-rc.2", "1.0.0-rc.1"), Some(Ordering::Greater));
    assert_eq!(c("1.0", "1.0.0"), None);
    assert_eq!(c("1.0.0.0", "1.0.0"), None);
    assert_eq!(c("1.x.0", "1.0.0"), None);
}

#[test]
fn urls() {
    let base = "https://github.com/zog-tech/herdling/releases";
    assert_eq!(update::manifest_url(base, None), format!("{base}/latest/download/latest.json"));
    assert_eq!(update::manifest_url(base, Some("0.2.0")), format!("{base}/download/herdlingd-v0.2.0/latest.json"));
    assert!(update::url_allowed(base, &format!("{base}/download/herdlingd-v0.2.0/herdlingd-x.tar.gz")));
    assert!(!update::url_allowed(base, "https://example.com/herdlingd.tar.gz"));
    assert!(!update::url_allowed(base, "https://github.com/zog-tech/herdling-evil/releases/download/x"));
    assert!(!update::url_allowed(base, &format!("{base}/download/../../evil")));
    assert!(!update::url_allowed(base, &format!("{base}/latest/download/x")));
}

#[tokio::test]
async fn check_reports_newer_release() {
    let f = fixture("0.2.0", "0.1.0", None, None).await;
    let r = update::check(&f.ctx, None).await.unwrap();
    assert_eq!(r.current, "0.1.0");
    assert_eq!(r.latest, "0.2.0");
    assert!(r.update_available);
    assert_eq!(r.notes, "Fixes.");
    assert_eq!(r.target, TARGET);
    let r = update::check(&f.ctx, Some("0.2.0")).await.unwrap();
    assert_eq!(r.latest, "0.2.0");
}

#[tokio::test]
async fn unsupported_target_is_an_error() {
    let mut f = fixture("0.2.0", "0.1.0", None, None).await;
    f.ctx.arch = "riscv64".into();
    assert_eq!(update::check(&f.ctx, None).await.unwrap_err().code, "unsupported_target");
    // A known target with no asset in the release.
    f.ctx.arch = "aarch64".into();
    assert_eq!(update::apply(&f.ctx, None, false).await.unwrap_err().code, "unsupported_target");
}

#[tokio::test]
async fn missing_release_is_update_unavailable() {
    let f = fixture("0.2.0", "0.1.0", None, None).await;
    let e = update::check(&f.ctx, Some("0.3.0")).await.unwrap_err();
    assert_eq!(e.code, "update_unavailable");
}

#[tokio::test]
async fn newer_release_replaces_the_exe() {
    let f = fixture("0.2.0", "0.1.0", None, None).await;
    let unit = f.ctx.home.join(".config/systemd/user/herdlingd.service");
    std::fs::create_dir_all(unit.parent().unwrap()).unwrap();
    std::fs::write(&unit, "[Unit]\n").unwrap();

    let r = update::apply(&f.ctx, None, false).await.unwrap();
    assert_eq!((r.from.as_str(), r.to.as_str(), r.status.as_str()), ("0.1.0", "0.2.0", "updated"));
    assert!(r.service_restarted);
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), NEW);
    assert_eq!(std::fs::metadata(&f.exe).unwrap().permissions().mode() & 0o777, 0o755);
    assert_eq!(bin_entries(&f), vec!["herdlingd".to_string()], "no temp file stays");
    assert_eq!(
        *f.runner.calls.lock().unwrap(),
        vec![vec!["systemctl".to_string(), "--user".into(), "restart".into(), "herdlingd.service".into()]]
    );
}

#[tokio::test]
async fn no_restart_without_a_service() {
    let f = fixture("0.2.0", "0.1.0", None, None).await;
    let r = update::apply(&f.ctx, None, false).await.unwrap();
    assert_eq!(r.status, "updated");
    assert!(!r.service_restarted);
    assert!(f.runner.calls.lock().unwrap().is_empty());
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), NEW);
}

#[tokio::test]
async fn checksum_mismatch_changes_nothing() {
    let bad = "0".repeat(64);
    let f = fixture("0.2.0", "0.1.0", Some(&bad), None).await;
    let e = update::apply(&f.ctx, None, false).await.unwrap_err();
    assert_eq!(e.code, "checksum_mismatch");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
    assert_eq!(bin_entries(&f), vec!["herdlingd".to_string()]);
    assert!(f.runner.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn same_version_is_a_no_op() {
    let f = fixture("0.2.0", "0.2.0", None, None).await;
    let r = update::apply(&f.ctx, None, false).await.unwrap();
    assert_eq!(r.status, "up_to_date");
    assert!(!r.service_restarted);
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
    let c = update::check(&f.ctx, None).await.unwrap();
    assert!(!c.update_available);
}

#[tokio::test]
async fn downgrade_needs_permission() {
    let f = fixture("0.2.0", "0.3.0", None, None).await;
    let e = update::apply(&f.ctx, None, false).await.unwrap_err();
    assert_eq!(e.code, "downgrade");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
    let r = update::apply(&f.ctx, Some("0.2.0"), true).await.unwrap();
    assert_eq!(r.status, "updated");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), NEW);
}

#[tokio::test]
async fn download_outside_the_release_base_is_refused() {
    let f = fixture("0.2.0", "0.1.0", None, Some("https://example.com/releases")).await;
    let e = update::apply(&f.ctx, None, false).await.unwrap_err();
    assert_eq!(e.code, "update_unavailable");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
}

#[tokio::test]
async fn second_update_at_the_same_time_is_refused() {
    let f = fixture("0.2.0", "0.1.0", None, None).await;
    let dir = f.ctx.home.join(".config/herdling");
    std::fs::create_dir_all(&dir).unwrap();
    let held = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join("update.lock")).unwrap();
    assert!(fs4::fs_std::FileExt::try_lock_exclusive(&held).unwrap());
    let e = update::apply(&f.ctx, None, false).await.unwrap_err();
    assert_eq!(e.code, "update_in_progress");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
}

#[tokio::test]
async fn rpc_without_update_settings_downloads_nothing() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let dir = tempfile::tempdir().unwrap();
    let ctx = herdlingd::rpc::Ctx::new(dir.path().join("none.sock"), dir.path().into());
    let (mut tx, server_in) = tokio::io::duplex(4096);
    let (server_out, rx) = tokio::io::duplex(4096);
    tokio::spawn(herdlingd::rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut lines = BufReader::new(rx).lines();
    tx.write_all(b"{\"id\":1,\"method\":\"update.apply\",\"params\":{}}\n").await.unwrap();
    let r: serde_json::Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(r["error"]["code"], "update_unavailable");
}
