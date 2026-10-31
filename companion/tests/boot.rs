//! The boot check and `mac.open_settings`, with a fake command runner. No real system command runs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use herdlingd::boot::{self, CmdOut, OpenError, Os, SysRunner};
use herdlingd::rpc::{self, Ctx};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Answers commands from a table and records every call.
#[derive(Default)]
struct Fake {
    answers: HashMap<String, CmdOut>,
    files: Vec<PathBuf>,
    calls: Mutex<Vec<String>>,
}

impl Fake {
    fn with(mut self, cmd: &str, success: bool, stdout: &str) -> Fake {
        self.answers.insert(cmd.into(), CmdOut { success, stdout: stdout.into(), stderr: String::new() });
        self
    }
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

impl SysRunner for Fake {
    fn run(&self, prog: &str, args: &[&str]) -> Option<CmdOut> {
        let line = std::iter::once(prog).chain(args.iter().copied()).collect::<Vec<_>>().join(" ");
        self.calls.lock().unwrap().push(line.clone());
        self.answers.get(&line).cloned()
    }
    fn exists(&self, path: &Path) -> bool {
        self.files.iter().any(|f| f == path)
    }
}

const LINGER: &str = "loginctl show-user sam -p Linger";
const FDE: &str = "/usr/bin/fdesetup status";
const AUTO: &str = "/usr/bin/defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser";

#[test]
fn parses_linger() {
    assert_eq!(boot::parse_linger("Linger=yes\n"), Some(true));
    assert_eq!(boot::parse_linger("Linger=no\n"), Some(false));
    assert_eq!(boot::parse_linger("Name=sam\n"), None);
}

#[test]
fn parses_filevault() {
    assert_eq!(boot::parse_filevault("FileVault is On.\n"), Some(true));
    assert_eq!(boot::parse_filevault("FileVault is Off.\n"), Some(false));
    assert_eq!(boot::parse_filevault("FileVault is Off, but will be enabled after the next restart.\n"), Some(true));
    assert_eq!(boot::parse_filevault("Encryption in progress: Percent completed = 12\n"), Some(true));
    assert_eq!(boot::parse_filevault("something new\n"), None);
}

#[test]
fn linux_linger_on_is_boot() {
    let f = Fake::default().with(LINGER, true, "Linger=yes\n");
    let b = boot::detect(Os::Linux, "sam", &f);
    assert_eq!(b.starts_at, "boot");
    assert_eq!(b.reason.as_deref(), Some("linger_on"));
    assert_eq!(b.user.as_deref(), Some("sam"));
}

#[test]
fn linux_linger_off_is_login_with_the_command() {
    let f = Fake::default().with(LINGER, true, "Linger=no\n");
    let b = boot::detect(Os::Linux, "sam", &f);
    assert_eq!(b.starts_at, "login");
    assert_eq!(b.reason.as_deref(), Some("linger_off"));
    assert!(b.how.contains("sudo loginctl enable-linger sam"), "{}", b.how);
}

#[test]
fn linux_without_loginctl_reads_the_linger_file() {
    let f = Fake { files: vec![PathBuf::from("/var/lib/systemd/linger/sam")], ..Fake::default() };
    assert_eq!(boot::detect(Os::Linux, "sam", &f).starts_at, "boot");
    let none = Fake::default();
    let b = boot::detect(Os::Linux, "sam", &none);
    assert_eq!(b.starts_at, "unknown");
}

#[test]
fn mac_auto_login_for_this_user_is_boot() {
    let f = Fake::default().with(FDE, true, "FileVault is Off.\n").with(AUTO, true, "sam\n");
    let b = boot::detect(Os::Macos, "sam", &f);
    assert_eq!(b.starts_at, "boot");
    assert_eq!(b.reason.as_deref(), Some("auto_login_on"));
}

#[test]
fn mac_without_auto_login_is_login() {
    // `defaults read` exits 1 when the key does not exist.
    let f = Fake::default().with(FDE, true, "FileVault is Off.\n").with(AUTO, false, "");
    let b = boot::detect(Os::Macos, "sam", &f);
    assert_eq!(b.starts_at, "login");
    assert_eq!(b.reason.as_deref(), Some("auto_login_off"));
    assert!(b.how.contains("Users & Groups"), "{}", b.how);
}

#[test]
fn mac_auto_login_for_another_user_is_login() {
    let f = Fake::default().with(FDE, true, "FileVault is Off.\n").with(AUTO, true, "alex\n");
    let b = boot::detect(Os::Macos, "sam", &f);
    assert_eq!(b.starts_at, "login");
    assert_eq!(b.reason.as_deref(), Some("auto_login_other_user"));
    assert!(b.how.contains("alex"));
}

#[test]
fn mac_filevault_on_blocks_auto_login() {
    let f = Fake::default().with(FDE, true, "FileVault is On.\n").with(AUTO, true, "sam\n");
    let b = boot::detect(Os::Macos, "sam", &f);
    assert_eq!(b.starts_at, "login");
    assert_eq!(b.reason.as_deref(), Some("filevault_on"));
    assert!(b.how.contains("FileVault"));
}

#[test]
fn cache_keeps_a_result_until_fresh() {
    let cache = boot::BootCache::default();
    let f = Fake::default().with(LINGER, true, "Linger=no\n");
    assert_eq!(cache.get(false, || boot::detect(Os::Linux, "sam", &f)).starts_at, "login");
    let g = Fake::default().with(LINGER, true, "Linger=yes\n");
    assert_eq!(cache.get(false, || boot::detect(Os::Linux, "sam", &g)).starts_at, "login");
    assert!(g.calls().is_empty());
    assert_eq!(cache.get(true, || boot::detect(Os::Linux, "sam", &g)).starts_at, "boot");
}

#[test]
fn open_settings_allows_only_listed_panes() {
    let f = Fake::default().with(
        "/usr/bin/open x-apple.systempreferences:com.apple.Users-Groups-Settings.extension",
        true,
        "",
    );
    assert!(boot::open_settings(Os::Macos, "users_groups", &f).is_ok());
    assert_eq!(boot::open_settings(Os::Macos, "https://example.com", &f), Err(OpenError::UnknownPane));
    assert_eq!(boot::open_settings(Os::Macos, "x-apple.systempreferences:com.apple.x", &f), Err(OpenError::UnknownPane));
    assert_eq!(boot::open_settings(Os::Linux, "users_groups", &f), Err(OpenError::UnsupportedPlatform));
    assert_eq!(f.calls().len(), 1);
    for (id, url) in boot::MAC_PANES {
        assert!(url.starts_with("x-apple.systempreferences:com.apple."), "{id}");
    }
}

#[test]
fn open_settings_failure_is_an_error() {
    let f = Fake::default().with("/usr/bin/open x-apple.systempreferences:com.apple.Sharing-Settings.extension", false, "");
    assert!(matches!(boot::open_settings(Os::Macos, "sharing", &f), Err(OpenError::Failed(_))));
}

async fn ask(ctx: Ctx, line: &str) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, rx) = tokio::io::duplex(65536);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(rx).lines();
    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap()
}

fn ctx_with(dir: &tempfile::TempDir, os: Os, fake: Arc<Fake>) -> Ctx {
    let mut ctx = Ctx::new(dir.path().join("none.sock"), dir.path().join("sam"));
    ctx.sys = Some(fake);
    ctx.host_os = os;
    ctx
}

#[tokio::test]
async fn hello_without_a_runner_has_no_boot() {
    let dir = tempfile::tempdir().unwrap();
    let r = ask(Ctx::new(dir.path().join("none.sock"), dir.path().into()), r#"{"id":1,"method":"hello"}"#).await;
    assert!(r["result"].get("boot").is_none(), "{r}");
    let r = ask(Ctx::new(dir.path().join("none.sock"), dir.path().into()), r#"{"id":2,"method":"boot.check"}"#).await;
    assert_eq!(r["error"]["code"], "unsupported_platform");
}

#[tokio::test]
async fn hello_and_boot_check_report_boot() {
    let dir = tempfile::tempdir().unwrap();
    // The user name comes from $USER when it is set, else from the home folder name.
    let user = std::env::var("USER").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| "sam".into());
    let fake = Arc::new(Fake::default().with(&format!("loginctl show-user {user} -p Linger"), true, "Linger=no\n"));
    let r = ask(ctx_with(&dir, Os::Linux, fake.clone()), r#"{"id":1,"method":"hello"}"#).await;
    assert_eq!(r["result"]["boot"]["starts_at"], "login", "{r}");
    assert!(r["result"]["boot"]["how"].as_str().unwrap().contains("enable-linger"));
    let r = ask(ctx_with(&dir, Os::Linux, fake), r#"{"id":2,"method":"boot.check"}"#).await;
    assert_eq!(r["result"]["starts_at"], "login", "{r}");
    assert_eq!(r["result"]["reason"], "linger_off");
}

#[tokio::test]
async fn mac_open_settings_over_rpc() {
    let dir = tempfile::tempdir().unwrap();
    let fake = Arc::new(Fake::default().with(
        "/usr/bin/open x-apple.systempreferences:com.apple.Users-Groups-Settings.extension",
        true,
        "",
    ));
    let r = ask(ctx_with(&dir, Os::Macos, fake.clone()), r#"{"id":1,"method":"mac.open_settings","params":{"pane":"users_groups"}}"#).await;
    assert_eq!(r["result"]["opened"], "users_groups", "{r}");
    let r = ask(ctx_with(&dir, Os::Macos, fake.clone()), r#"{"id":2,"method":"mac.open_settings","params":{"pane":"file:///etc/passwd"}}"#).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = ask(ctx_with(&dir, Os::Macos, fake.clone()), r#"{"id":3,"method":"mac.open_settings","params":{}}"#).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = ask(ctx_with(&dir, Os::Linux, fake.clone()), r#"{"id":4,"method":"mac.open_settings","params":{"pane":"sharing"}}"#).await;
    assert_eq!(r["error"]["code"], "unsupported_platform");
    assert_eq!(fake.calls().len(), 1);
}
