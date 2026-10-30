use std::cell::RefCell;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use zogsshd::install::*;

struct Fake {
    calls: RefCell<Vec<Vec<String>>>,
    linger: &'static str,
}

impl Runner for Fake {
    fn run(&self, cmd: &[String]) -> anyhow::Result<String> {
        self.calls.borrow_mut().push(cmd.to_vec());
        if cmd[1] == "bootout" {
            anyhow::bail!("not loaded");
        }
        Ok(self.linger.to_string())
    }
}

fn fake(linger: &'static str) -> Fake {
    Fake { calls: RefCell::new(vec![]), linger }
}

fn opts(home: &Path, os: Os, dry_run: bool) -> InstallOpts {
    let exe = home.join("built-zogsshd");
    fs::write(&exe, b"#!/bin/sh\n").unwrap();
    InstallOpts { home: home.to_path_buf(), exe, os, dry_run }
}

#[test]
fn plist_runs_serve() {
    let p = launchd_plist(Path::new("/home/sam/.local/bin/zogsshd"), Path::new("/home/sam"));
    let a = p.find("<string>/home/sam/.local/bin/zogsshd</string>").unwrap();
    let b = p.find("<string>serve</string>").unwrap();
    assert!(a < b);
    assert!(p.contains("<key>KeepAlive</key>"));
    assert!(p.contains("<key>RunAtLoad</key>"));
    assert!(p.contains("<string>/home/sam/Library/Logs/zogsshd.log</string>"));
    assert!(p.contains("<string>/home/sam/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>"));
}

#[test]
fn unit_runs_serve() {
    let u = systemd_unit(Path::new("/home/sam/.local/bin/zogsshd"));
    assert!(u.contains("ExecStart=/home/sam/.local/bin/zogsshd serve"));
    assert!(u.contains("Restart=always"));
    assert!(u.contains("RestartSec=5"));
    assert!(u.contains("Environment=PATH=/home/sam/.local/bin:/usr/local/bin:/usr/bin:/bin"));
    assert!(u.contains("WantedBy=default.target"));
}

#[test]
fn dry_run_copies_binary_and_writes_unit() {
    for os in [Os::Macos, Os::Linux] {
        let home = tempfile::tempdir().unwrap();
        let r = install(&opts(home.path(), os, true)).unwrap();
        assert_eq!(r.bin, home.path().join(".local/bin/zogsshd"));
        assert_eq!(fs::metadata(&r.bin).unwrap().permissions().mode() & 0o777, 0o755);
        assert!(r.unit_path.starts_with(home.path()));
        assert!(fs::read_to_string(&r.unit_path).unwrap().contains("serve"));
        assert!(!r.commands.is_empty());
        assert_eq!(r.next_steps.last().unwrap(), "Pair your phone: zogsshd pair");
    }
}

#[test]
fn reinstall_is_idempotent() {
    let home = tempfile::tempdir().unwrap();
    let o = opts(home.path(), Os::Linux, true);
    let first = install(&o).unwrap();
    let unit = fs::read_to_string(&first.unit_path).unwrap();
    // The second run installs the already installed binary itself: same file, no copy.
    let again = InstallOpts { exe: first.bin.clone(), ..o };
    let second = install(&again).unwrap();
    assert_eq!(fs::read_to_string(&second.unit_path).unwrap(), unit);
    assert_eq!(fs::read(&second.bin).unwrap(), b"#!/bin/sh\n");
    assert_eq!(fs::metadata(&second.bin).unwrap().permissions().mode() & 0o777, 0o755);
}

#[test]
fn macos_runs_bootout_then_bootstrap_and_ignores_bootout_error() {
    let home = tempfile::tempdir().unwrap();
    let f = fake("");
    let r = install_with(&opts(home.path(), Os::Macos, false), &f).unwrap();
    let calls = f.calls.borrow();
    assert_eq!(*calls, r.commands);
    assert_eq!(calls[0][..2], ["launchctl", "bootout"]);
    assert!(calls[0][2].ends_with("/com.zogtech.zogsshd"));
    assert_eq!(calls[1][..2], ["launchctl", "bootstrap"]);
    assert_eq!(calls[1][3], r.unit_path.display().to_string());
}

#[test]
fn linux_suggests_linger_only_when_off() {
    let home = tempfile::tempdir().unwrap();
    let off = fake("Linger=no\n");
    let r = install_with(&opts(home.path(), Os::Linux, false), &off).unwrap();
    assert_eq!(off.calls.borrow()[1][..4], ["systemctl", "--user", "enable", "--now"]);
    assert!(r.next_steps.iter().any(|s| s.contains("sudo loginctl enable-linger")));
    assert_eq!(r.next_steps.last().unwrap(), "Pair your phone: zogsshd pair");

    let on = fake("Linger=yes\n");
    let r = install_with(&opts(home.path(), Os::Linux, false), &on).unwrap();
    assert!(!r.next_steps.iter().any(|s| s.contains("linger")));
}

#[test]
fn dry_run_runs_nothing() {
    let home = tempfile::tempdir().unwrap();
    let f = fake("");
    install_with(&opts(home.path(), Os::Linux, true), &f).unwrap();
    assert!(f.calls.borrow().is_empty());
}

struct FlakyBootstrap {
    calls: RefCell<Vec<Vec<String>>>,
    fails_left: RefCell<u32>,
}

impl Runner for FlakyBootstrap {
    fn run(&self, cmd: &[String]) -> anyhow::Result<String> {
        self.calls.borrow_mut().push(cmd.to_vec());
        if cmd[1] == "bootstrap" && *self.fails_left.borrow() > 0 {
            *self.fails_left.borrow_mut() -= 1;
            anyhow::bail!("Bootstrap failed: 5: Input/output error");
        }
        Ok(String::new())
    }
}

#[test]
fn bootstrap_is_retried_after_bootout() {
    let home = tempfile::tempdir().unwrap();
    let r = FlakyBootstrap { calls: RefCell::new(vec![]), fails_left: RefCell::new(1) };
    install_with(&opts(home.path(), Os::Macos, false), &r).unwrap();
    let boots = r.calls.borrow().iter().filter(|c| c[1] == "bootstrap").count();
    assert_eq!(boots, 2);
}

#[test]
fn linux_reinstall_restarts_the_unit() {
    let home = tempfile::tempdir().unwrap();
    let f = fake("Linger=yes");
    install_with(&opts(home.path(), Os::Linux, false), &f).unwrap();
    assert!(f.calls.borrow().iter().any(|c| c[..] == ["systemctl", "--user", "restart", "zogsshd.service"]));
}
