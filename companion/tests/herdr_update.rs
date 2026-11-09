//! `herdr.update` with a fake runner. No test runs a real herdr.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use herdlingd::herdr_update::{self as hu, Exit, Handoff, HerdrRunner, HerdrUpdateCtx, RunOut};

fn os(k: &str, v: &str) -> (OsString, OsString) {
    (k.into(), v.into())
}

fn ok(stdout: &str) -> RunOut {
    RunOut { exit: Exit::Exited { success: true, code: Some(0) }, stdout: stdout.into(), stderr: String::new() }
}

fn fail(code: i32, stderr: &str) -> RunOut {
    RunOut { exit: Exit::Exited { success: false, code: Some(code) }, stdout: String::new(), stderr: stderr.into() }
}

/// One recorded call: the binary, the args and the env.
type Call = (PathBuf, Vec<String>, Vec<(OsString, OsString)>);

/// Answers `--version` with the versions in turn, and `update` with `update`. Records each call.
struct Fake {
    versions: Mutex<Vec<&'static str>>,
    update: RunOut,
    calls: Mutex<Vec<Call>>,
}

impl Fake {
    fn new(versions: &[&'static str], update: RunOut) -> Arc<Fake> {
        Arc::new(Fake { versions: Mutex::new(versions.to_vec()), update, calls: Mutex::new(Vec::new()) })
    }
}

impl HerdrRunner for Fake {
    fn run(&self, bin: &Path, args: &[&str], env: &[(OsString, OsString)], _timeout: Duration) -> RunOut {
        self.calls.lock().unwrap().push((bin.into(), args.iter().map(|a| a.to_string()).collect(), env.to_vec()));
        if args == hu::VERSION_ARGS {
            let mut v = self.versions.lock().unwrap();
            let next = if v.is_empty() { "" } else { v.remove(0) };
            return ok(next);
        }
        self.update.clone()
    }
}

fn found(_: &[PathBuf]) -> Option<PathBuf> {
    Some(PathBuf::from("/home/sam/.local/bin/herdr"))
}

fn missing(_: &[PathBuf]) -> Option<PathBuf> {
    None
}

fn ctx(dir: &Path, runner: Arc<Fake>) -> HerdrUpdateCtx {
    HerdrUpdateCtx {
        lock_dir: dir.join("cfg"),
        dirs: vec![PathBuf::from("/home/sam/.local/bin")],
        env: vec![
            os("HOME", "/home/sam"),
            os("PATH", "/usr/bin"),
            os("HERDR_ENV", "1"),
            os("HERDR_SESSION", "s1"),
            os("HERDR_PANE_ID", "p1"),
            os("HERDR_SOCKET_PATH", "/tmp/h.sock"),
            os("HERDR_HOME", "/home/sam/.herdr"),
        ],
        runner,
        timeout: Duration::from_secs(5),
        finder: found,
    }
}

#[test]
fn search_dirs_puts_path_first_and_adds_the_usual_folders_once() {
    let home = Path::new("/home/sam");
    let path = OsString::from("/usr/bin:/home/sam/.local/bin::/bin");
    let dirs = hu::search_dirs(home, Some(&path));
    let want: Vec<PathBuf> = ["/usr/bin", "/home/sam/.local/bin", "/bin", "/home/sam/.cargo/bin", "/opt/homebrew/bin", "/usr/local/bin"]
        .iter()
        .map(PathBuf::from)
        .collect();
    assert_eq!(dirs, want);
    assert_eq!(hu::search_dirs(home, None).len(), 4);
}

#[test]
fn find_takes_the_first_executable_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (dir.path().join("a"), dir.path().join("b"));
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    use std::os::unix::fs::PermissionsExt;
    // A file that is not executable does not count.
    std::fs::write(a.join("herdr"), "x").unwrap();
    std::fs::write(b.join("herdr"), "x").unwrap();
    std::fs::set_permissions(b.join("herdr"), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(hu::find(&[a.clone(), b.clone()]), Some(b.join("herdr")));
    assert_eq!(hu::find(&[a]), None);
}

#[test]
fn child_env_drops_session_vars_and_sets_path() {
    let env = hu::child_env(
        vec![
            os("HOME", "/home/sam"),
            os("PATH", "/usr/bin"),
            os("HERDR_ENV", "1"),
            os("HERDR_SESSION", "s"),
            os("HERDR_PANE_ID", "p"),
            os("HERDR_TAB_ID", "t"),
            os("HERDR_WORKSPACE_ID", "w"),
            os("HERDR_SOCKET_PATH", "/tmp/s"),
            os("HERDR_CLIENT_SOCKET_PATH", "/tmp/c"),
            os("HERDR_BIN_PATH", "/x"),
            os("HERDR_PLUGIN_ID", "x"),
            os("HERDR_HOME", "/home/sam/.herdr"),
            os("HERDR_CONFIG_PATH", "/home/sam/c.toml"),
        ],
        &[PathBuf::from("/home/sam/.local/bin"), PathBuf::from("/usr/bin")],
    );
    let names: Vec<String> = env.iter().map(|(k, _)| k.to_string_lossy().into_owned()).collect();
    assert_eq!(names, ["HOME", "HERDR_HOME", "HERDR_CONFIG_PATH", "PATH"]);
    let path = &env.last().unwrap().1;
    assert_eq!(path, &OsString::from("/home/sam/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"));
}

#[test]
fn parse_version_reads_the_last_word() {
    assert_eq!(hu::parse_version("herdr 0.9.5\n").as_deref(), Some("0.9.5"));
    assert_eq!(hu::parse_version("\nherdr v1.2.3-preview.1").as_deref(), Some("1.2.3-preview.1"));
    assert_eq!(hu::parse_version("0.10.0").as_deref(), Some("0.10.0"));
    assert_eq!(hu::parse_version("herdr dev"), None);
    assert_eq!(hu::parse_version(""), None);
}

#[test]
fn handoff_and_package_manager_lines() {
    assert_eq!(hu::handoff_of("live handoff complete for default; pane processes should still be running."), Handoff::Complete);
    assert_eq!(hu::handoff_of("live handoff failed, but the old server is still running"), Handoff::Failed);
    assert_eq!(hu::handoff_of("installed 0.9.6"), Handoff::None);
    assert!(hu::is_managed("self-update is disabled for Homebrew installs; run `brew upgrade herdr`"));
    assert!(!hu::is_managed("installed 0.9.6"));
}

#[test]
fn cap_tail_keeps_the_end_on_a_char_boundary() {
    assert_eq!(hu::cap_tail("short", 10), "short");
    assert_eq!(hu::cap_tail("abcdef", 3), "…def");
    // "é" is two bytes: the cut moves forward to a boundary.
    assert_eq!(hu::cap_tail("aééb", 4), "…éb");
}

#[test]
fn run_uses_the_fixed_argv_and_a_clean_env() {
    let dir = tempfile::tempdir().unwrap();
    let fake = Fake::new(&["herdr 0.9.5", "herdr 0.9.6"], ok("installed 0.9.6\nlive handoff complete for default; pane processes should still be running."));
    let r = hu::run(&ctx(dir.path(), fake.clone())).unwrap();
    assert_eq!(r.from.as_deref(), Some("0.9.5"));
    assert_eq!(r.to.as_deref(), Some("0.9.6"));
    assert_eq!(r.status, "updated");
    assert_eq!(r.handoff, "complete");
    assert!(r.output.contains("installed 0.9.6"));

    let calls = fake.calls.lock().unwrap();
    let argvs: Vec<Vec<String>> = calls.iter().map(|c| c.1.clone()).collect();
    assert_eq!(argvs, [vec!["--version"], vec!["update", "--handoff"], vec!["--version"]]);
    for (bin, _, env) in calls.iter() {
        assert_eq!(bin, Path::new("/home/sam/.local/bin/herdr"));
        assert!(env.iter().all(|(k, _)| !k.to_string_lossy().starts_with("HERDR_") || k == "HERDR_HOME"), "{env:?}");
    }
}

#[test]
fn same_version_or_herdr_text_is_up_to_date() {
    let dir = tempfile::tempdir().unwrap();
    let r = hu::run(&ctx(dir.path(), Fake::new(&["herdr 0.9.5", "herdr 0.9.5"], ok("checking stable channel for updates...")))).unwrap();
    assert_eq!(r.status, "up_to_date");
    assert_eq!(r.handoff, "none");
    let r = hu::run(&ctx(dir.path(), Fake::new(&["", ""], ok("herdr 0.9.5 is already up to date.")))).unwrap();
    assert_eq!((r.from, r.to, r.status.as_str()), (None, None, "up_to_date"));
}

#[test]
fn handoff_failure_is_reported_and_not_called_complete() {
    let dir = tempfile::tempdir().unwrap();
    let out = ok("installed 0.9.6\nlive handoff failed, but the old server is still running with your panes.");
    let r = hu::run(&ctx(dir.path(), Fake::new(&["herdr 0.9.5", "herdr 0.9.6"], out))).unwrap();
    assert_eq!(r.status, "updated");
    assert_eq!(r.handoff, "failed");
}

#[test]
fn package_manager_install_gives_managed_install() {
    let dir = tempfile::tempdir().unwrap();
    let out = fail(1, "error: self-update is disabled for Homebrew installs; run `brew update && brew upgrade herdr`");
    let e = hu::run(&ctx(dir.path(), Fake::new(&["herdr 0.9.5", "herdr 0.9.5"], out))).unwrap_err();
    assert_eq!(e.code, "managed_install");
    assert!(e.message.contains("package manager"));
}

#[test]
fn other_failures_carry_the_output() {
    let dir = tempfile::tempdir().unwrap();
    let e = hu::run(&ctx(dir.path(), Fake::new(&[], fail(2, "network down")))).unwrap_err();
    assert_eq!(e.code, "command_failed");
    assert!(e.message.contains("network down") && e.message.contains('2'), "{}", e.message);

    let timed = RunOut { exit: Exit::TimedOut, stdout: "downloading".into(), stderr: String::new() };
    let e = hu::run(&ctx(dir.path(), Fake::new(&[], timed))).unwrap_err();
    assert_eq!(e.code, "timeout");

    let spawn = RunOut { exit: Exit::SpawnFailed("denied".into()), stdout: String::new(), stderr: String::new() };
    assert_eq!(hu::run(&ctx(dir.path(), Fake::new(&[], spawn))).unwrap_err().code, "command_failed");
}

#[test]
fn missing_herdr_gives_not_installed_and_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let fake = Fake::new(&[], ok(""));
    let mut c = ctx(dir.path(), fake.clone());
    c.finder = missing;
    assert_eq!(hu::run(&c).unwrap_err().code, "not_installed");
    assert!(fake.calls.lock().unwrap().is_empty());
}

#[test]
fn a_held_lock_gives_busy_and_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let fake = Fake::new(&[], ok(""));
    let c = ctx(dir.path(), fake.clone());
    let _held = hu::take_lock(&c.lock_dir).unwrap();
    assert_eq!(hu::run(&c).unwrap_err().code, "busy");
    assert!(fake.calls.lock().unwrap().is_empty());
}

#[test]
fn output_is_capped() {
    let big = "x".repeat(hu::OUTPUT_LIMIT * 2);
    let r = hu::shape(Some("1.0.0".into()), Some("1.0.1".into()), &ok(&big)).unwrap();
    assert!(r.output.len() <= hu::OUTPUT_LIMIT + "…".len());
}

#[test]
fn system_runner_runs_without_a_shell_and_with_only_the_given_env() {
    let r = hu::SystemHerdrRunner.run(Path::new("/usr/bin/env"), &[], &[os("ONLY", "1")], Duration::from_secs(5));
    assert_eq!(r.exit, Exit::Exited { success: true, code: Some(0) });
    assert_eq!(r.stdout.trim(), "ONLY=1");
}

#[test]
fn system_runner_stops_a_slow_child() {
    let r = hu::SystemHerdrRunner.run(Path::new("/bin/sleep"), &["30"], &[], Duration::from_millis(300));
    assert_eq!(r.exit, Exit::TimedOut);
}
