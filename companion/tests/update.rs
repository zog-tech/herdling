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
use base64::Engine as _;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
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

/// How the fake release signs `latest.json`.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Sig {
    /// A good signature of the test key.
    Good,
    /// No `latest.json.sig` file.
    Missing,
    /// A signature of the same bytes by another key.
    OtherKey,
    /// A signature by the test key of other bytes.
    OtherBytes,
    /// Text that is not a signature.
    Garbage,
}

/// A throwaway Ed25519 key pair for one test.
fn test_key() -> Ed25519KeyPair {
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
    Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap()
}

/// The text of a `.sig` file: the base64 of the raw 64-byte signature, then a line end.
fn sig_file(key: &Ed25519KeyPair, data: &[u8]) -> Vec<u8> {
    format!("{}\n", base64::engine::general_purpose::STANDARD.encode(key.sign(data).as_ref())).into_bytes()
}

/// A release server with `version` whose asset has `sha` (None: the real checksum) and `url_base`
/// (None: the server). The running version is `current`. The manifest has a good signature.
async fn fixture(version: &str, current: &str, sha: Option<&str>, url_base: Option<&str>) -> Fixture {
    fixture_signed(version, current, sha, url_base, Sig::Good).await
}

async fn fixture_signed(version: &str, current: &str, sha: Option<&str>, url_base: Option<&str>, sig: Sig) -> Fixture {
    let key = test_key();
    let other = test_key();
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
    let body = manifest(&base);
    let sig_body = match sig {
        Sig::Good => Some(sig_file(&key, &body)),
        Sig::Missing => None,
        Sig::OtherKey => Some(sig_file(&other, &body)),
        Sig::OtherBytes => Some(sig_file(&key, b"{\"version\":\"9.9.9\",\"assets\":{}}")),
        Sig::Garbage => Some(b"not a signature\n".to_vec()),
    };
    for folder in ["latest/download".to_string(), format!("download/herdlingd-v{version}")] {
        files.insert(format!("{folder}/latest.json"), body.clone());
        if let Some(s) = &sig_body {
            files.insert(format!("{folder}/latest.json.sig"), s.clone());
        }
    }
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
        release_keys: vec![key.public_key().as_ref().to_vec()],
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

#[test]
fn url_check_refuses_encoded_dot_segments_and_other_hosts() {
    let base = "https://github.com/zog-tech/herdling/releases";
    for bad in [
        format!("{base}/download/%2e%2e/%2e%2e/evil/x.tar.gz"),
        format!("{base}/download/%2E%2E/x.tar.gz"),
        format!("{base}/download/.%2e/x.tar.gz"),
        format!("{base}/download/herdlingd-v1.0.0/%2e/x.tar.gz"),
        format!("{base}/download/a/./x.tar.gz"),
        format!("{base}/download/a%2fb/x.tar.gz"),
        format!("{base}/download/a%5cb/x.tar.gz"),
        format!("{base}/download/"),
        "http://github.com/zog-tech/herdling/releases/download/v/x.tar.gz".to_string(),
        "https://github.com:8443/zog-tech/herdling/releases/download/v/x.tar.gz".to_string(),
        "https://user@github.com/zog-tech/herdling/releases/download/v/x.tar.gz".to_string(),
        "https://github.com.evil.test/zog-tech/herdling/releases/download/v/x.tar.gz".to_string(),
        "https://GITHUB.com/zog-tech/herdling/releases/download/../../x".to_string(),
        format!("{base}/download/v/x.tar.gz?x=1"),
        format!("{base}/download/v/x.tar.gz#f"),
        "not a url".to_string(),
    ] {
        assert!(!update::url_allowed(base, &bad), "{bad}");
    }
    // A host name in upper case is the same host.
    assert!(update::url_allowed(base, "https://GitHub.com/zog-tech/herdling/releases/download/herdlingd-v0.2.0/x.tar.gz"));
    // A local test base with a port.
    let local = "http://127.0.0.1:4100/releases";
    assert!(update::url_allowed(local, "http://127.0.0.1:4100/releases/download/herdlingd-v0.2.0/x.tar.gz"));
    assert!(!update::url_allowed(local, "http://127.0.0.1:4101/releases/download/herdlingd-v0.2.0/x.tar.gz"));
}

#[test]
fn version_pre_release_is_limited() {
    assert!(update::parse_version("1.0.0-rc.1").is_some());
    assert!(update::parse_version("1.0.0-beta-2").is_some());
    for bad in ["1.0.0-x/../../..", "1.0.0-..", "1.0.0-a..b", "1.0.0-a%2f", "1.0.0-a b", "1.0.0-a?b", "1.0.0-a#b", "1.0.0-é"] {
        assert_eq!(update::parse_version(bad), None, "{bad}");
    }
}

#[tokio::test]
async fn update_lock_folder_is_private() {
    let f = fixture("0.2.0", "0.2.0", None, None).await;
    let dir = f.ctx.home.join(".config/herdling");
    assert!(!dir.exists());
    update::apply(&f.ctx, None, false).await.unwrap();
    assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
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

/// `update::apply`, tried again for a short time while it gives `update_in_progress`. Other
/// tests in this process start `tar` at the same time. A child process holds a copy of every
/// open file until it starts `tar`, so for a moment it can also hold the lock of this test.
async fn apply_when_unlocked(ctx: &UpdateCtx, version: Option<&str>, allow_downgrade: bool) -> herdlingd::types::UpdateApply {
    for _ in 0..50 {
        match update::apply(ctx, version, allow_downgrade).await {
            Err(e) if e.code == "update_in_progress" => tokio::time::sleep(std::time::Duration::from_millis(20)).await,
            r => return r.unwrap(),
        }
    }
    panic!("the update lock stayed taken");
}

#[tokio::test]
async fn downgrade_needs_permission() {
    let f = fixture("0.2.0", "0.3.0", None, None).await;
    let e = update::apply(&f.ctx, None, false).await.unwrap_err();
    assert_eq!(e.code, "downgrade");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
    let r = apply_when_unlocked(&f.ctx, Some("0.2.0"), true).await;
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

#[test]
fn embedded_release_keys_are_valid() {
    let keys = update::release_keys();
    assert!(!keys.is_empty());
    assert_eq!(keys.len(), update::RELEASE_KEYS.len(), "every embedded key is 32 bytes of base64");
}

#[test]
fn verify_manifest_checks_the_exact_bytes() {
    let key = test_key();
    let keys = vec![key.public_key().as_ref().to_vec()];
    let body = br#"{"version":"0.2.0","assets":{}}"#;
    update::verify_manifest(body, &sig_file(&key, body), &keys).unwrap();
    // One more byte, a changed byte, and a signature of other bytes are all refused.
    let mut longer = body.to_vec();
    longer.push(b'\n');
    assert_eq!(update::verify_manifest(&longer, &sig_file(&key, body), &keys).unwrap_err().code, "bad_signature");
    let changed = br#"{"version":"0.3.0","assets":{}}"#;
    assert_eq!(update::verify_manifest(changed, &sig_file(&key, body), &keys).unwrap_err().code, "bad_signature");
    // Bad texts and an empty key list.
    for bad in [&b""[..], b"AAAA", b"\xff\xfe", b"not base64!"] {
        assert_eq!(update::verify_manifest(body, bad, &keys).unwrap_err().code, "bad_signature");
    }
    assert_eq!(update::verify_manifest(body, &sig_file(&key, body), &[]).unwrap_err().code, "bad_signature");
    // The production keys do not accept the test key.
    let prod = update::release_keys();
    assert_eq!(update::verify_manifest(body, &sig_file(&key, body), &prod).unwrap_err().code, "bad_signature");
}

#[test]
fn verify_manifest_accepts_any_listed_key() {
    let old = test_key();
    let new = test_key();
    let keys = vec![old.public_key().as_ref().to_vec(), new.public_key().as_ref().to_vec()];
    let body = b"{}";
    update::verify_manifest(body, &sig_file(&old, body), &keys).unwrap();
    update::verify_manifest(body, &sig_file(&new, body), &keys).unwrap();
    assert_eq!(update::verify_manifest(body, &sig_file(&new, body), &keys[..1]).unwrap_err().code, "bad_signature");
}

#[tokio::test]
async fn unsigned_or_badly_signed_release_is_refused() {
    for sig in [Sig::Missing, Sig::OtherKey, Sig::OtherBytes, Sig::Garbage] {
        let f = fixture_signed("0.2.0", "0.1.0", None, None, sig).await;
        assert_eq!(update::check(&f.ctx, None).await.unwrap_err().code, "bad_signature", "{sig:?}");
        assert_eq!(update::check(&f.ctx, Some("0.2.0")).await.unwrap_err().code, "bad_signature", "{sig:?}");
        let e = update::apply(&f.ctx, None, false).await.unwrap_err();
        assert_eq!(e.code, "bad_signature", "{sig:?}: {}", e.message);
        assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
        assert_eq!(bin_entries(&f), vec!["herdlingd".to_string()]);
        assert!(f.runner.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn production_keys_refuse_a_release_of_another_key() {
    let mut f = fixture("0.2.0", "0.1.0", None, None).await;
    f.ctx.release_keys = update::release_keys();
    assert_eq!(update::apply(&f.ctx, None, false).await.unwrap_err().code, "bad_signature");
    assert_eq!(std::fs::read_to_string(&f.exe).unwrap(), OLD);
}
