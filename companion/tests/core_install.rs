//! The herdr-core install: the pin, the pure state machine, the herdr 1 guard and the real I/O
//! with a fake process runner, a fake download and a fake socket probe. No test downloads,
//! runs a real core or writes outside a temp folder.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use herdlingd::core_install::guard::{self, Guard, UpdateTarget};
use herdlingd::core_install::machine::{
    self, decide, place_mode, Decision, Effect, Found, Input, Outcome, PlaceMode, Plan, State, Status, Step, Where,
};
use herdlingd::core_install::pin::{self, CorePin};
use herdlingd::core_install::{self as ci, CoreInstallCtx, CoreIo};
use herdlingd::herdr_update::{Exit, HerdrRunner, RunOut};

const PIN: &str = "0.1.20";
const SHA: &str = "5f3037379d15cc76cfc72d2fd1a4262ea1c5b24df278bf7cfd8adcff7b914862";

fn plan() -> Plan {
    Plan { pin: PIN.into(), sha256: SHA.into(), mac: false }
}

fn found(at: Where, v: Option<&str>) -> Found {
    Found { at, version: v.map(String::from) }
}

// ---- pin ----

#[test]
fn the_embedded_pin_is_valid_and_has_every_unix_target() {
    let p = pin::embedded();
    assert!(p.valid(), "{p:?}");
    for t in ["macos-aarch64", "macos-x86_64", "linux-aarch64", "linux-x86_64"] {
        assert!(p.sha_for(t).is_some(), "no checksum for {t}");
    }
    // Plan E turns it on for 0.2.0. Until then the installer keeps herdr 1.
    assert!(!p.required);
}

#[test]
fn targets_and_urls() {
    assert_eq!(pin::target("macos", "aarch64"), Some("macos-aarch64"));
    assert_eq!(pin::target("macos", "x86_64"), Some("macos-x86_64"));
    assert_eq!(pin::target("linux", "aarch64"), Some("linux-aarch64"));
    assert_eq!(pin::target("linux", "x86_64"), Some("linux-x86_64"));
    assert_eq!(pin::target("windows", "x86_64"), None);
    assert_eq!(pin::target("linux", "riscv64"), None);
    let p = pin::embedded();
    assert_eq!(
        p.url("linux-x86_64"),
        format!("https://releases.herdr.dev/core/{}/herdr-core-linux-x86_64.tar.gz", p.version)
    );
}

#[test]
fn a_bad_pin_is_not_valid() {
    let good = CorePin { version: PIN.into(), required: false, sha256: BTreeMap::from([("linux-x86_64".into(), SHA.into())]) };
    assert!(good.valid());
    for v in ["0.1", "../0.1.20", "0.1.20-rc1", "0.1.20/x", ""] {
        assert!(!CorePin { version: v.into(), ..good.clone() }.valid(), "{v}");
    }
    let short = CorePin { sha256: BTreeMap::from([("linux-x86_64".into(), "abc".into())]), ..good.clone() };
    assert!(!short.valid());
    let upper = CorePin { sha256: BTreeMap::from([("linux-x86_64".into(), SHA.to_uppercase())]), ..good.clone() };
    assert!(!upper.valid());
    let odd_target = CorePin { sha256: BTreeMap::from([("windows-x86_64".into(), SHA.into())]), ..good.clone() };
    assert!(!odd_target.valid());
    assert!(!CorePin { sha256: BTreeMap::new(), ..good }.valid());
}

// ---- pure decisions ----

#[test]
fn decisions() {
    assert_eq!(decide(&found(Where::Missing, None), PIN), Decision::Install);
    assert_eq!(decide(&found(Where::Ours, Some("0.1.19")), PIN), Decision::Update);
    assert_eq!(decide(&found(Where::Ours, Some("0.1.20")), PIN), Decision::UpToDate);
    assert_eq!(decide(&found(Where::Ours, Some("0.1.21")), PIN), Decision::KeepNewer);
    assert_eq!(decide(&found(Where::Ours, Some("0.2.0")), PIN), Decision::KeepNewer);
    assert_eq!(decide(&found(Where::Ours, None), PIN), Decision::KeepUnknown);
    assert_eq!(decide(&found(Where::Ours, Some("weird")), PIN), Decision::KeepUnknown);
    // A package manager's core is never replaced, also when it is older.
    assert_eq!(decide(&found(Where::Managed, Some("0.1.2")), PIN), Decision::KeepManaged);
}

#[test]
fn place_modes() {
    assert_eq!(place_mode(true, true, false), PlaceMode::Bundle { update: false });
    assert_eq!(place_mode(true, true, true), PlaceMode::Bundle { update: true });
    assert_eq!(place_mode(true, false, true), PlaceMode::SwapFrom);
    assert_eq!(place_mode(false, true, true), PlaceMode::SwapFrom);
    assert_eq!(place_mode(false, false, false), PlaceMode::Copy);
}

/// Runs the machine with scripted inputs and returns the effects and the end.
fn run_machine(plan: &Plan, inputs: Vec<Input>) -> (Vec<Effect>, Step) {
    let mut effects = Vec::new();
    let (mut state, mut input) = (State::Begin, Input::Go);
    let mut inputs = inputs.into_iter();
    loop {
        match machine::step(plan, state, input) {
            Step::Next(s, e) => {
                effects.push(e);
                state = s;
                input = inputs.next().expect("the machine wants more input");
            }
            end => return (effects, end),
        }
    }
}

#[test]
fn a_first_install_downloads_checks_places_and_starts() {
    let (effects, end) = run_machine(
        &plan(),
        vec![
            Input::Installed(found(Where::Missing, None)),
            Input::Downloaded(Ok(SHA.into())),
            Input::Unpacked(Ok(false)),
            Input::Checked(Ok(Some("0.1.20".into()))),
            Input::Placed(Ok(())),
            Input::Running(None),
            Input::Started(Ok(())),
            Input::Running(Some("0.1.20".into())),
        ],
    );
    assert_eq!(
        effects,
        vec![
            Effect::FindInstalled,
            Effect::Download,
            Effect::Unpack,
            Effect::CheckUnpacked,
            Effect::Place(PlaceMode::Copy),
            Effect::ProbeRunning { wait: true },
            Effect::Start,
            Effect::ProbeRunning { wait: true },
        ]
    );
    assert_eq!(end, Step::Done(Outcome { from: None, to: Some(PIN.into()), status: Status::Installed, started: true }));
}

#[test]
fn an_update_swaps_and_does_not_start_a_running_core() {
    let (effects, end) = run_machine(
        &plan(),
        vec![
            Input::Installed(found(Where::Ours, Some("0.1.19"))),
            Input::Downloaded(Ok(SHA.to_uppercase())),
            Input::Unpacked(Ok(false)),
            Input::Checked(Ok(Some("0.1.20".into()))),
            Input::Placed(Ok(())),
            Input::Running(Some("0.1.20".into())),
        ],
    );
    assert!(effects.contains(&Effect::Place(PlaceMode::SwapFrom)));
    assert!(!effects.contains(&Effect::Start));
    assert_eq!(end, Step::Done(Outcome { from: Some("0.1.19".into()), to: Some(PIN.into()), status: Status::Updated, started: false }));
}

#[test]
fn a_mac_update_uses_the_app_bundle() {
    let mac = Plan { mac: true, ..plan() };
    let (effects, _) = run_machine(
        &mac,
        vec![
            Input::Installed(found(Where::Ours, Some("0.1.19"))),
            Input::Downloaded(Ok(SHA.into())),
            Input::Unpacked(Ok(true)),
            Input::Checked(Ok(Some("0.1.20".into()))),
            Input::Placed(Ok(())),
            Input::Running(Some("0.1.20".into())),
        ],
    );
    assert!(effects.contains(&Effect::Place(PlaceMode::Bundle { update: true })));
}

#[test]
fn never_downgrade_a_newer_core() {
    let (effects, end) = run_machine(&plan(), vec![Input::Installed(found(Where::Ours, Some("0.1.25"))), Input::Running(Some("0.1.25".into()))]);
    assert_eq!(effects, vec![Effect::FindInstalled, Effect::ProbeRunning { wait: false }]);
    assert_eq!(end, Step::Done(Outcome { from: Some("0.1.25".into()), to: Some("0.1.25".into()), status: Status::KeptNewer, started: false }));
}

#[test]
fn kept_cores_still_get_started() {
    for (f, status) in [
        (found(Where::Ours, Some("0.1.20")), Status::UpToDate),
        (found(Where::Ours, None), Status::KeptUnknown),
        (found(Where::Managed, Some("0.1.2")), Status::KeptManaged),
    ] {
        let (effects, end) = run_machine(
            &plan(),
            vec![Input::Installed(f.clone()), Input::Running(None), Input::Started(Ok(())), Input::Running(Some(String::new()))],
        );
        assert!(!effects.contains(&Effect::Download), "{f:?}");
        assert_eq!(effects.last(), Some(&Effect::ProbeRunning { wait: true }));
        match end {
            Step::Done(o) => {
                assert_eq!(o.status, status);
                assert!(o.started);
            }
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn a_checksum_mismatch_stops_before_the_unpack() {
    let (effects, end) = run_machine(&plan(), vec![Input::Installed(found(Where::Missing, None)), Input::Downloaded(Ok("00".repeat(32)))]);
    assert_eq!(effects, vec![Effect::FindInstalled, Effect::Download]);
    match end {
        Step::Fail(f) => {
            assert_eq!(f.code, "checksum_mismatch");
            assert!(f.message.contains("Nothing was installed"), "{}", f.message);
        }
        other => panic!("{other:?}"),
    }
}

fn fail_code(end: Step) -> &'static str {
    match end {
        Step::Fail(f) => f.code,
        other => panic!("not a failure: {other:?}"),
    }
}

#[test]
fn failures() {
    let missing = || Input::Installed(found(Where::Missing, None));
    let (_, end) = run_machine(&plan(), vec![missing(), Input::Downloaded(Err("HTTP 404".into()))]);
    assert_eq!(fail_code(end), "download_failed");
    let (_, end) = run_machine(&plan(), vec![missing(), Input::Downloaded(Ok(SHA.into())), Input::Unpacked(Err("bad gzip".into()))]);
    assert_eq!(fail_code(end), "install_failed");
    // The unpacked core says another version: the release does not match the pin.
    let (_, end) = run_machine(
        &plan(),
        vec![missing(), Input::Downloaded(Ok(SHA.into())), Input::Unpacked(Ok(false)), Input::Checked(Ok(Some("0.1.21".into())))],
    );
    assert_eq!(fail_code(end), "install_failed");
    let (_, end) = run_machine(
        &plan(),
        vec![missing(), Input::Downloaded(Ok(SHA.into())), Input::Unpacked(Ok(false)), Input::Checked(Err("exec format error".into()))],
    );
    assert_eq!(fail_code(end), "install_failed");
    let (_, end) = run_machine(
        &plan(),
        vec![
            missing(),
            Input::Downloaded(Ok(SHA.into())),
            Input::Unpacked(Ok(false)),
            Input::Checked(Ok(Some(PIN.into()))),
            Input::Placed(Err("read-only".into())),
        ],
    );
    assert_eq!(fail_code(end), "install_failed");
    let (_, end) = run_machine(&plan(), vec![Input::Installed(found(Where::Ours, Some(PIN))), Input::Running(None), Input::Started(Err("no".into()))]);
    assert_eq!(fail_code(end), "core_not_running");
    let (_, end) = run_machine(
        &plan(),
        vec![Input::Installed(found(Where::Ours, Some(PIN))), Input::Running(None), Input::Started(Ok(())), Input::Running(None)],
    );
    assert_eq!(fail_code(end), "core_not_running");
}

#[test]
fn an_impossible_event_fails_and_never_panics() {
    assert_eq!(fail_code(machine::step(&plan(), State::Begin, Input::Running(None))), "internal");
    assert_eq!(fail_code(machine::step(&plan(), State::Probe, Input::Placed(Ok(())))), "internal");
    let s = State::Fetch { update: false, from: None };
    assert_eq!(fail_code(machine::step(&plan(), s, Input::Go)), "internal");
}

// ---- guard ----

#[test]
fn guard_table() {
    assert_eq!(guard::guard(false, false, true), Guard::Proceed);
    assert_eq!(guard::guard(false, true, false), Guard::Proceed);
    assert_eq!(guard::guard(true, false, true), Guard::InstallCoreFirst { herdr1: true });
    assert_eq!(guard::guard(true, false, false), Guard::InstallCoreFirst { herdr1: false });
    assert_eq!(guard::guard(true, true, true), Guard::EnsureCore);
    assert_eq!(guard::notice(Guard::InstallCoreFirst { herdr1: true }), Some(guard::HERDR1_NOTICE));
    assert_eq!(guard::notice(Guard::InstallCoreFirst { herdr1: false }), None);
    assert_eq!(guard::notice(Guard::EnsureCore), None);
}

#[test]
fn herdr_update_targets() {
    assert_eq!(guard::herdr_update_target(true, true), UpdateTarget::Herdr1);
    assert_eq!(guard::herdr_update_target(true, false), UpdateTarget::Herdr1);
    assert_eq!(guard::herdr_update_target(false, true), UpdateTarget::Core);
    assert_eq!(guard::herdr_update_target(false, false), UpdateTarget::Herdr1);
}

// ---- status ----

#[test]
fn status_fields() {
    let p = CorePin { version: PIN.into(), required: false, sha256: BTreeMap::from([("linux-x86_64".into(), SHA.into())]) };
    let s = ci::status_of(&found(Where::Ours, Some("0.1.21")), Some("0.1.21".into()), &p, Some("linux-x86_64"), true);
    assert!(s.found && s.running && s.newer_than_pin && !s.update_available && !s.managed && s.herdr1);
    assert_eq!(s.running_version.as_deref(), Some("0.1.21"));
    assert_eq!(s.pinned, PIN);
    let s = ci::status_of(&found(Where::Missing, None), None, &p, Some("linux-x86_64"), false);
    assert!(!s.found && !s.running && s.update_available && !s.newer_than_pin);
    assert_eq!(s.installed, None);
    // No build for this computer: nothing to install.
    let s = ci::status_of(&found(Where::Missing, None), None, &p, None, false);
    assert!(!s.update_available);
    // A running core that says no version still runs.
    let s = ci::status_of(&found(Where::Managed, Some("0.1.2")), Some(String::new()), &p, Some("linux-x86_64"), false);
    assert!(s.running && s.managed && !s.update_available);
    assert_eq!(s.running_version, None);
    // A newer running core with an older file (the Herdr app updated the core elsewhere).
    let s = ci::status_of(&found(Where::Ours, Some("0.1.19")), Some("0.1.22".into()), &p, Some("linux-x86_64"), false);
    assert!(s.newer_than_pin && s.update_available);
}

// ---- the real I/O with fakes ----

fn ok(stdout: &str) -> RunOut {
    RunOut { exit: Exit::Exited { success: true, code: Some(0) }, stdout: stdout.into(), stderr: String::new() }
}

fn bad(stderr: &str) -> RunOut {
    RunOut { exit: Exit::Exited { success: false, code: Some(1) }, stdout: String::new(), stderr: stderr.into() }
}

/// One recorded call: the binary, the args and the env.
type Call = (PathBuf, Vec<String>, Vec<(OsString, OsString)>);

/// A fake core: `--version` gives `installed` for the core in `~/.local/bin` and `unpacked` for
/// a core in the stage folder. `server start` sets `running`. Records each call.
struct FakeCore {
    installed: Mutex<Option<String>>,
    unpacked: String,
    running: Arc<AtomicBool>,
    start_ok: bool,
    calls: Mutex<Vec<Call>>,
}

impl HerdrRunner for FakeCore {
    fn run(&self, bin: &Path, args: &[&str], env: &[(OsString, OsString)], _t: Duration) -> RunOut {
        self.calls.lock().unwrap().push((bin.into(), args.iter().map(|a| a.to_string()).collect(), env.to_vec()));
        let staged = bin.to_string_lossy().contains("/.cache/herdling/core.");
        match args {
            ["--version"] if staged => ok(&format!("hc {}\n", self.unpacked)),
            ["--version"] => match self.installed.lock().unwrap().as_deref() {
                Some(v) => ok(&format!("hc {v}\n")),
                None => bad("not here"),
            },
            ["server", "start"] if self.start_ok => {
                self.running.store(true, Ordering::SeqCst);
                ok("")
            }
            ["server", "start"] => bad("cannot start"),
            ["update", "--from", _] => {
                *self.installed.lock().unwrap() = Some(self.unpacked.clone());
                ok("")
            }
            _ => bad("unexpected"),
        }
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    ctx: CoreInstallCtx,
    core: Arc<FakeCore>,
    urls: Arc<Mutex<Vec<String>>>,
    pin: CorePin,
}

impl Fixture {
    fn home(&self) -> &Path {
        &self.ctx.home
    }
    fn calls(&self) -> Vec<Vec<String>> {
        self.core.calls.lock().unwrap().iter().map(|c| c.1.clone()).collect()
    }
}

/// A tarball with a `herdr-core` file (never run: the runner is a fake).
fn tarball(dir: &Path) -> Vec<u8> {
    let src = dir.join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("herdr-core"), "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::write(src.join("LICENSE"), "Apache-2.0\n").unwrap();
    let out = dir.join("core.tar.gz");
    let st = std::process::Command::new("tar").arg("-czf").arg(&out).arg("-C").arg(&src).arg("herdr-core").arg("LICENSE").status().unwrap();
    assert!(st.success());
    std::fs::read(out).unwrap()
}

/// `installed`: the version of a core already in `~/.local/bin` (None: no core). `serve`: the
/// bytes that the fake download gives (None: the real test tarball).
fn fixture(installed: Option<&str>, serve: Option<Vec<u8>>, running: bool, start_ok: bool) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let tar = tarball(dir.path());
    let sha = herdlingd::update::sha256_hex(&tar);
    let body = serve.unwrap_or(tar);
    if installed.is_some() {
        let bin = home.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("herdr-core"), "old").unwrap();
        std::fs::set_permissions(bin.join("herdr-core"), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let run = Arc::new(AtomicBool::new(running));
    let core = Arc::new(FakeCore {
        installed: Mutex::new(installed.map(String::from)),
        unpacked: PIN.into(),
        running: run.clone(),
        start_ok,
        calls: Mutex::new(Vec::new()),
    });
    let urls = Arc::new(Mutex::new(Vec::new()));
    let u = urls.clone();
    let pin = CorePin { version: PIN.into(), required: false, sha256: BTreeMap::from([("linux-x86_64".into(), sha)]) };
    let ctx = CoreInstallCtx {
        home: home.clone(),
        dirs: vec![home.join(".local/bin"), dir.path().join("usr-bin")],
        env: vec![
            ("HOME".into(), home.clone().into_os_string()),
            ("PATH".into(), "/usr/bin".into()),
            ("HC_TERMINAL_ID".into(), "t9".into()),
            ("HC_SESSION".into(), "default".into()),
        ],
        runner: core.clone(),
        fetch: Arc::new(move |url: &str| {
            u.lock().unwrap().push(url.to_string());
            Ok(body.clone())
        }),
        probe: Arc::new(move |_wait| run.load(Ordering::SeqCst).then(|| PIN.to_string())),
        mac: false,
        target: Some("linux-x86_64".into()),
        pin: pin.clone(),
        lock_dir: home.join(".config/herdling"),
    };
    Fixture { _dir: dir, ctx, core, urls, pin }
}

fn stage_root(f: &Fixture) -> Vec<String> {
    match std::fs::read_dir(f.home().join(".cache/herdling")) {
        Ok(rd) => rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect(),
        Err(_) => Vec::new(),
    }
}

#[test]
fn a_fresh_install_copies_links_hc_and_starts_the_core() {
    let f = fixture(None, None, false, true);
    let r = ci::install(&f.ctx, &f.pin).unwrap();
    assert_eq!(r.status, "installed");
    assert_eq!(r.to.as_deref(), Some(PIN));
    assert!(r.started);
    let bin = f.home().join(".local/bin");
    let core = bin.join("herdr-core");
    assert_eq!(std::fs::read_to_string(&core).unwrap(), "#!/bin/sh\nexit 0\n");
    assert_eq!(std::fs::metadata(&core).unwrap().permissions().mode() & 0o777, 0o755);
    assert_eq!(std::fs::read_link(bin.join("hc")).unwrap(), PathBuf::from("herdr-core"));
    assert_eq!(f.urls.lock().unwrap().as_slice(), [f.pin.url("linux-x86_64")]);
    assert!(f.calls().contains(&vec!["server".to_string(), "start".to_string()]));
    // The stage folder is gone, and no temp file stays beside the core.
    assert!(stage_root(&f).iter().all(|n| !n.starts_with("core.")), "{:?}", stage_root(&f));
    let names: Vec<String> = std::fs::read_dir(&bin).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.iter().all(|n| !n.starts_with(".herdr-core.new")), "{names:?}");
    // Children never get the variables of a core terminal.
    for (_, _, env) in f.core.calls.lock().unwrap().iter() {
        assert!(!env.iter().any(|(k, _)| k == "HC_TERMINAL_ID"), "{env:?}");
        assert!(env.iter().any(|(k, _)| k == "HC_SESSION"));
    }
}

#[test]
fn a_checksum_mismatch_installs_nothing() {
    let f = fixture(None, Some(b"not the pinned tarball".to_vec()), false, true);
    let e = ci::install(&f.ctx, &f.pin).unwrap_err();
    assert_eq!(e.code, "checksum_mismatch");
    assert!(!f.home().join(".local/bin").exists());
    assert!(stage_root(&f).iter().all(|n| !n.starts_with("core.")));
    // Nothing ran: not the download, not a start.
    assert!(f.calls().is_empty(), "{:?}", f.calls());
}

#[test]
fn a_newer_core_is_never_downgraded() {
    let f = fixture(Some("0.1.30"), None, true, true);
    let r = ci::install(&f.ctx, &f.pin).unwrap();
    assert_eq!(r.status, "kept_newer");
    assert_eq!(r.to.as_deref(), Some("0.1.30"));
    assert!(f.urls.lock().unwrap().is_empty(), "it must not download");
    assert_eq!(std::fs::read_to_string(f.home().join(".local/bin/herdr-core")).unwrap(), "old");
    assert!(!f.calls().iter().any(|c| c.first().map(String::as_str) == Some("update")));
}

#[test]
fn an_older_core_swaps_itself_with_update_from() {
    let f = fixture(Some("0.1.19"), None, true, true);
    let r = ci::install(&f.ctx, &f.pin).unwrap();
    assert_eq!((r.status.as_str(), r.from.as_deref(), r.to.as_deref()), ("updated", Some("0.1.19"), Some(PIN)));
    assert!(!r.started);
    let calls = f.core.calls.lock().unwrap();
    let swap = calls.iter().find(|c| c.1.first().map(String::as_str) == Some("update")).expect("update --from");
    assert_eq!(swap.0, f.ctx.home.join(".local/bin/herdr-core"));
    assert_eq!(swap.1[1], "--from");
    assert!(swap.1[2].contains("/.cache/herdling/core."), "{}", swap.1[2]);
}

#[test]
fn a_managed_core_is_kept_and_started() {
    let f = fixture(None, None, false, true);
    let usr = f._dir.path().join("usr-bin");
    std::fs::create_dir_all(&usr).unwrap();
    std::fs::write(usr.join("herdr-core"), "brew").unwrap();
    std::fs::set_permissions(usr.join("herdr-core"), std::fs::Permissions::from_mode(0o755)).unwrap();
    *f.core.installed.lock().unwrap() = Some("0.1.2".into());
    let r = ci::install(&f.ctx, &f.pin).unwrap();
    assert_eq!(r.status, "kept_managed");
    assert!(r.started);
    assert!(f.urls.lock().unwrap().is_empty());
    assert!(!f.home().join(".local/bin/herdr-core").exists());
    // The start uses the managed core.
    let calls = f.core.calls.lock().unwrap();
    let start = calls.iter().find(|c| c.1 == ["server", "start"]).unwrap();
    assert_eq!(start.0, usr.join("herdr-core"));
}

#[test]
fn a_core_that_does_not_start_is_an_error() {
    let f = fixture(Some(PIN), None, false, false);
    let e = ci::install(&f.ctx, &f.pin).unwrap_err();
    assert_eq!(e.code, "core_not_running");
    assert!(e.message.contains("cannot start"), "{}", e.message);
}

#[test]
fn a_second_install_waits_for_the_lock() {
    let f = fixture(None, None, false, true);
    let _held = ci::take_lock(&f.ctx.lock_dir).unwrap();
    assert_eq!(ci::install(&f.ctx, &f.pin).unwrap_err().code, "busy");
    assert!(f.urls.lock().unwrap().is_empty());
}

#[test]
fn no_build_or_a_bad_pin_is_an_error() {
    let mut f = fixture(None, None, false, true);
    let bad = CorePin { version: "x".into(), ..f.pin.clone() };
    assert_eq!(ci::install(&f.ctx, &bad).unwrap_err().code, "bad_pin");
    f.ctx.target = None;
    assert_eq!(ci::install(&f.ctx, &f.pin).unwrap_err().code, "unsupported_target");
    assert!(f.urls.lock().unwrap().is_empty());
}

#[test]
fn status_only_reads() {
    let f = fixture(Some("0.1.19"), None, true, true);
    let s = ci::status(&f.ctx);
    assert!(s.found && s.running && s.update_available && !s.newer_than_pin && !s.herdr1);
    assert_eq!(s.installed.as_deref(), Some("0.1.19"));
    assert_eq!(s.target.as_deref(), Some("linux-x86_64"));
    assert!(f.urls.lock().unwrap().is_empty());
    assert_eq!(f.calls(), vec![vec!["--version".to_string()]]);
}

/// A scripted `CoreIo` for the driver: it answers from fixed values and counts downloads.
struct Scripted {
    found: Found,
    downloads: usize,
}

impl CoreIo for Scripted {
    fn find_installed(&mut self) -> Found {
        self.found.clone()
    }
    fn download(&mut self, _url: &str) -> Result<String, String> {
        self.downloads += 1;
        Ok(SHA.into())
    }
    fn unpack(&mut self) -> Result<bool, String> {
        Ok(false)
    }
    fn check_unpacked(&mut self) -> Result<Option<String>, String> {
        Ok(Some(PIN.into()))
    }
    fn place(&mut self, _m: PlaceMode) -> Result<(), String> {
        Ok(())
    }
    fn running(&mut self, _w: bool) -> Option<String> {
        Some(PIN.into())
    }
    fn start(&mut self) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn the_driver_ends_and_maps_failures() {
    let mut io = Scripted { found: found(Where::Missing, None), downloads: 0 };
    let o = ci::drive(&plan(), "u", &mut io).unwrap();
    assert_eq!((o.status, io.downloads), (Status::Installed, 1));
    let mut io = Scripted { found: found(Where::Ours, Some("9.9.9")), downloads: 0 };
    assert_eq!(ci::drive(&plan(), "u", &mut io).unwrap().status, Status::KeptNewer);
    assert_eq!(io.downloads, 0);
    let wrong = Plan { sha256: "11".repeat(32), ..plan() };
    let mut io = Scripted { found: found(Where::Missing, None), downloads: 0 };
    assert_eq!(ci::drive(&wrong, "u", &mut io).unwrap_err().code, "checksum_mismatch");
}
