//! `herdlingd install`: copies the binary to `~/.local/bin` and registers a user service
//! (launchd on macOS, systemd on Linux) that runs `herdlingd serve`.

use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

pub const LABEL: &str = "com.zogtech.herdlingd";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Macos,
    Linux,
}

pub struct InstallOpts {
    pub home: PathBuf,
    pub exe: PathBuf,
    pub os: Os,
    /// Write the files but run no command.
    pub dry_run: bool,
}

#[derive(Debug)]
pub struct InstallReport {
    pub bin: PathBuf,
    pub unit_path: PathBuf,
    pub commands: Vec<Vec<String>>,
    pub next_steps: Vec<String>,
}

/// Runs the service-manager commands. Tests pass a fake.
pub trait Runner {
    /// Runs the command and returns its stdout. An error means a non-zero exit or a spawn failure.
    fn run(&self, cmd: &[String]) -> Result<String>;
}

pub struct SystemRunner;

impl Runner for SystemRunner {
    fn run(&self, cmd: &[String]) -> Result<String> {
        let (prog, args) = cmd.split_first().context("empty command")?;
        let out = Command::new(prog).args(args).output().with_context(|| format!("run {prog}"))?;
        if !out.status.success() {
            bail!("{} failed: {}", cmd.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn launchd_plist(bin: &Path, home: &Path) -> String {
    let bin = xml_escape(&bin.display().to_string());
    let log = xml_escape(&home.join("Library/Logs/herdlingd.log").display().to_string());
    let path = xml_escape(&format!("{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", home.join(".local/bin").display()));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{bin}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>{log}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{path}</string>
  </dict>
</dict>
</plist>
"#
    )
}

pub fn systemd_unit(bin: &Path) -> String {
    // Derived from the binary path (`<home>/.local/bin/herdlingd`).
    let home = bin.parent().and_then(Path::parent).and_then(Path::parent).unwrap_or(Path::new("/"));
    format!(
        "[Unit]\nDescription=herdlingd companion for Herdling\nAfter=network-online.target\n\n\
         [Service]\nExecStart={} serve\nRestart=always\nRestartSec=5\n\
         Environment=PATH={}:/usr/local/bin:/usr/bin:/bin\n\n\
         [Install]\nWantedBy=default.target\n",
        bin.display(),
        home.join(".local/bin").display()
    )
}

/// Installs with the real command runner.
pub fn install(o: &InstallOpts) -> Result<InstallReport> {
    install_with(o, &SystemRunner)
}

pub fn install_with(o: &InstallOpts, runner: &dyn Runner) -> Result<InstallReport> {
    let bin = o.home.join(".local/bin/herdlingd");
    copy_binary(&o.exe, &bin)?;

    let user = crate::serve::http::current_user(&o.home);
    let (unit_path, unit, commands) = match o.os {
        Os::Macos => {
            let uid = fs::metadata(&o.home).with_context(|| format!("stat {}", o.home.display()))?.uid();
            let unit_path = o.home.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
            fs::create_dir_all(o.home.join("Library/Logs"))?;
            let cmds = vec![
                vec!["launchctl".into(), "bootout".into(), format!("gui/{uid}/{LABEL}")],
                vec!["launchctl".into(), "bootstrap".into(), format!("gui/{uid}"), unit_path.display().to_string()],
            ];
            (unit_path, launchd_plist(&bin, &o.home), cmds)
        }
        Os::Linux => {
            let unit_path = o.home.join(".config/systemd/user/herdlingd.service");
            let cmds = vec![
                vec!["systemctl".into(), "--user".into(), "daemon-reload".into()],
                vec!["systemctl".into(), "--user".into(), "enable".into(), "--now".into(), "herdlingd.service".into()],
                // `enable --now` leaves a running unit alone; restart it so a reinstall runs the new binary.
                vec!["systemctl".into(), "--user".into(), "restart".into(), "herdlingd.service".into()],
            ];
            (unit_path, systemd_unit(&bin), cmds)
        }
    };
    fs::create_dir_all(unit_path.parent().context("unit path has no parent")?)?;
    fs::write(&unit_path, unit).with_context(|| format!("write {}", unit_path.display()))?;
    fs::set_permissions(&unit_path, fs::Permissions::from_mode(0o644))?;

    let mut next_steps = Vec::new();
    if !o.dry_run {
        for cmd in &commands {
            let res = runner.run(cmd);
            match cmd.get(1).map(String::as_str) {
                // `bootout` fails when the service is not loaded yet.
                Some("bootout") => {}
                // launchd can refuse a `bootstrap` (error 5) for a moment after `bootout`.
                Some("bootstrap") if res.is_err() => {
                    let mut last = res;
                    for _ in 0..5 {
                        std::thread::sleep(std::time::Duration::from_secs(1));
                        last = runner.run(cmd);
                        if last.is_ok() {
                            break;
                        }
                    }
                    last?;
                }
                _ => {
                    res?;
                }
            }
        }
        if o.os == Os::Linux {
            let q = vec!["loginctl".into(), "show-user".into(), user.clone(), "-p".into(), "Linger".into()];
            if runner.run(&q).is_ok_and(|out| out.contains("Linger=no")) {
                next_steps.push(format!("Keep the service running after logout: sudo loginctl enable-linger {user}"));
            }
        }
    }
    next_steps.push("Pair your phone: herdlingd pair".into());
    Ok(InstallReport { bin, unit_path, commands, next_steps })
}

/// Copies `exe` to `dest` with mode 0755. Does nothing when both are the same file.
fn copy_binary(exe: &Path, dest: &Path) -> Result<()> {
    if let (Ok(a), Ok(b)) = (fs::metadata(exe), fs::metadata(dest)) {
        if a.dev() == b.dev() && a.ino() == b.ino() {
            return Ok(());
        }
    }
    fs::create_dir_all(dest.parent().context("binary path has no parent")?)?;
    // Copy to a temp name and rename: a running copy of the old binary is replaced safely.
    let tmp = dest.with_extension("new");
    fs::copy(exe, &tmp).with_context(|| format!("copy {} to {}", exe.display(), tmp.display()))?;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    fs::rename(&tmp, dest)?;
    Ok(())
}
