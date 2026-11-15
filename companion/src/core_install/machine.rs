//! The pure install flow of herdr-core: which version to keep, how to put the new one in place,
//! and which step comes next.
//!
//! `step(plan, state, input)` gives the next state and one effect for the driver to run, or the
//! end. The driver (`core_install::drive`) runs the effect and sends back its result as the next
//! input. No I/O here.
//!
//! Rules:
//! - Never downgrade. A core newer than the pin, or of an unknown version, stays as it is.
//! - Only `~/.local/bin/herdr-core` belongs to herdlingd. A core that a package manager installed
//!   stays as it is.
//! - The download must have the pinned SHA-256, and the unpacked core must say the pinned version.
//! - At the end the core runs: herdlingd starts it when no core answers.

use std::cmp::Ordering;

use crate::update::compare_versions;

/// Where the installed core is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Where {
    /// No `herdr-core` found.
    Missing,
    /// `~/.local/bin/herdr-core`: the place of the upstream installer. herdlingd may replace it.
    Ours,
    /// A `herdr-core` in another folder (Homebrew, Nix, conda). herdlingd never replaces it.
    Managed,
}

/// The installed core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub at: Where,
    /// The version that `herdr-core --version` gave. None when it gave none.
    pub version: Option<String>,
}

/// What to do with the installed core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// No core: install the pin.
    Install,
    /// Our core is older than the pin: update it.
    Update,
    /// Our core is the pin.
    UpToDate,
    /// The core is newer than the pin (the Herdr app updates it too). Keep it.
    KeepNewer,
    /// The version is not known. Keep the core: it can be newer.
    KeepUnknown,
    /// A package manager owns the core. Keep it.
    KeepManaged,
}

/// The decision for `found` and the pinned version `pin`.
pub fn decide(found: &Found, pin: &str) -> Decision {
    match found.at {
        Where::Missing => Decision::Install,
        Where::Managed => Decision::KeepManaged,
        Where::Ours => match found.version.as_deref().and_then(|v| compare_versions(v, pin)) {
            None => Decision::KeepUnknown,
            Some(Ordering::Less) => Decision::Update,
            Some(Ordering::Equal) => Decision::UpToDate,
            Some(Ordering::Greater) => Decision::KeepNewer,
        },
    }
}

/// How the new core goes into `~/.local/bin`, as the upstream installer does it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaceMode {
    /// macOS: `Herdr Core.app` with `--hc-install-bundle`. On an update, then `server restart`.
    Bundle { update: bool },
    /// An installed core swaps itself: `herdr-core update --from <file>`. Terminals keep running.
    SwapFrom,
    /// A first install: copy the file.
    Copy,
}

/// The place mode. `bundle` is true when the tarball has `Herdr Core.app`.
pub fn place_mode(mac: bool, bundle: bool, update: bool) -> PlaceMode {
    if mac && bundle {
        PlaceMode::Bundle { update }
    } else if update {
        PlaceMode::SwapFrom
    } else {
        PlaceMode::Copy
    }
}

/// The fixed facts of one install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// The pinned version.
    pub pin: String,
    /// The pinned SHA-256 of the tarball for this computer (lower-case hex).
    pub sha256: String,
    /// True on macOS.
    pub mac: bool,
}

/// The result of a finished flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Installed,
    Updated,
    UpToDate,
    KeptNewer,
    KeptUnknown,
    KeptManaged,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Installed => "installed",
            Status::Updated => "updated",
            Status::UpToDate => "up_to_date",
            Status::KeptNewer => "kept_newer",
            Status::KeptUnknown => "kept_unknown",
            Status::KeptManaged => "kept_managed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    /// The version before. None when no core was installed or it gave no version.
    pub from: Option<String>,
    /// The installed version after.
    pub to: Option<String>,
    pub status: Status,
    /// True when herdlingd started the core.
    pub started: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

fn fail(code: &'static str, message: impl Into<String>) -> Step {
    Step::Fail(Failure { code, message: message.into() })
}

/// Where the flow is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    /// Before the first effect.
    Begin,
    /// Waits for `Input::Installed`.
    Probe,
    /// Waits for `Input::Downloaded`. `from` is the version before (None: a first install).
    Fetch { update: bool, from: Option<String> },
    /// Waits for `Input::Unpacked`.
    Unpack { update: bool, from: Option<String> },
    /// Waits for `Input::Checked`.
    Check { mode: PlaceMode, update: bool, from: Option<String> },
    /// Waits for `Input::Placed`.
    Place { update: bool, from: Option<String> },
    /// Waits for `Input::Running`. `started` is true after herdlingd started the core.
    Verify { outcome: Outcome },
    /// Waits for `Input::Started`.
    Start { outcome: Outcome },
}

/// The result of the last effect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    /// Starts the flow.
    Go,
    Installed(Found),
    /// The SHA-256 of the download, or the error text.
    Downloaded(Result<String, String>),
    /// True when the tarball has `Herdr Core.app`.
    Unpacked(Result<bool, String>),
    /// The version that the unpacked core gave (None: no version text).
    Checked(Result<Option<String>, String>),
    Placed(Result<(), String>),
    /// The version of the running core. None when no core answers.
    Running(Option<String>),
    Started(Result<(), String>),
}

/// An I/O request for the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    FindInstalled,
    Download,
    Unpack,
    CheckUnpacked,
    Place(PlaceMode),
    /// Asks the core socket. `wait`: give a core that just started some seconds.
    ProbeRunning { wait: bool },
    Start,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Next(State, Effect),
    Done(Outcome),
    Fail(Failure),
}

fn verify(outcome: Outcome, wait: bool) -> Step {
    Step::Next(State::Verify { outcome }, Effect::ProbeRunning { wait })
}

/// The next step of the flow.
pub fn step(plan: &Plan, state: State, input: Input) -> Step {
    match (state, input) {
        (State::Begin, Input::Go) => Step::Next(State::Probe, Effect::FindInstalled),
        (State::Probe, Input::Installed(found)) => {
            let from = found.version.clone();
            let keep = |status| verify(Outcome { from: from.clone(), to: from.clone(), status, started: false }, false);
            match decide(&found, &plan.pin) {
                Decision::Install => Step::Next(State::Fetch { update: false, from: None }, Effect::Download),
                Decision::Update => Step::Next(State::Fetch { update: true, from }, Effect::Download),
                Decision::UpToDate => keep(Status::UpToDate),
                Decision::KeepNewer => keep(Status::KeptNewer),
                Decision::KeepUnknown => keep(Status::KeptUnknown),
                Decision::KeepManaged => keep(Status::KeptManaged),
            }
        }
        (State::Fetch { update, from }, Input::Downloaded(r)) => match r {
            Err(e) => fail("download_failed", format!("cannot download herdr-core {}: {e}", plan.pin)),
            Ok(sha) if sha.eq_ignore_ascii_case(&plan.sha256) => Step::Next(State::Unpack { update, from }, Effect::Unpack),
            Ok(sha) => fail(
                "checksum_mismatch",
                format!(
                    "the download of herdr-core {} has sha256 {sha}, the pin says {}. Nothing was installed",
                    plan.pin, plan.sha256
                ),
            ),
        },
        (State::Unpack { update, from }, Input::Unpacked(r)) => match r {
            Err(e) => fail("install_failed", format!("cannot unpack herdr-core: {e}")),
            Ok(bundle) => {
                let mode = place_mode(plan.mac, bundle, update);
                Step::Next(State::Check { mode, update, from }, Effect::CheckUnpacked)
            }
        },
        (State::Check { mode, update, from }, Input::Checked(r)) => match r {
            Err(e) => fail("install_failed", format!("the downloaded herdr-core does not run on this computer: {e}")),
            Ok(Some(v)) if compare_versions(&v, &plan.pin) == Some(Ordering::Equal) => {
                Step::Next(State::Place { update, from }, Effect::Place(mode))
            }
            Ok(v) => fail(
                "install_failed",
                format!("the downloaded herdr-core says version {}, the pin is {}", v.as_deref().unwrap_or("(none)"), plan.pin),
            ),
        },
        (State::Place { update, from }, Input::Placed(r)) => match r {
            Err(e) => fail("install_failed", format!("cannot install herdr-core {}: {e}", plan.pin)),
            Ok(()) => {
                let status = if update { Status::Updated } else { Status::Installed };
                verify(Outcome { from, to: Some(plan.pin.clone()), status, started: false }, true)
            }
        },
        (State::Verify { outcome }, Input::Running(r)) => match r {
            Some(_) => Step::Done(outcome),
            None if outcome.started => {
                fail("core_not_running", "herdr-core was started, but it does not answer on its socket")
            }
            None => Step::Next(State::Start { outcome }, Effect::Start),
        },
        (State::Start { outcome }, Input::Started(r)) => match r {
            Err(e) => fail("core_not_running", format!("cannot start herdr-core: {e}")),
            Ok(()) => verify(Outcome { started: true, ..outcome }, true),
        },
        (state, input) => fail("internal", format!("the core install got {input:?} in the state {state:?}")),
    }
}
