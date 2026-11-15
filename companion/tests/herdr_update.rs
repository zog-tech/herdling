//! The process helpers that the herdr-core install uses. No test runs a real herdr.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use herdlingd::herdr_update::{self as hu, Exit, HerdrRunner};

fn os(k: &str, v: &str) -> (OsString, OsString) {
    (k.into(), v.into())
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
fn cap_tail_keeps_the_end_on_a_char_boundary() {
    assert_eq!(hu::cap_tail("short", 10), "short");
    assert_eq!(hu::cap_tail("abcdef", 3), "…def");
    // "é" is two bytes: the cut moves forward to a boundary.
    assert_eq!(hu::cap_tail("aééb", 4), "…éb");
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
