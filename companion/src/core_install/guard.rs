//! The herdr 1 guard of the update to a herdlingd that works only with Herdr 2 (herdr-core).
//!
//! A computer that runs herdr 1 and has no core must not update herdlingd and silently lose the
//! app. When the new release needs the core (`requires_core` in its manifest), the update installs
//! the core first. When that install fails, the update stops and the old herdlingd stays.
//! See "Users still on herdr 1" in `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md`.
//!
//! Pure: the facts come in as parameters.

/// What the update does before it replaces herdlingd.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Guard {
    /// Nothing to do first.
    Proceed,
    /// Install (or update) herdr-core first. `herdr1`: the computer runs herdr 1, so tell the
    /// user that herdr 1 sessions do not show in Herdling any more.
    InstallCoreFirst { herdr1: bool },
    /// The core is installed. Make sure that it runs and has at least the pin (never down).
    EnsureCore,
}

/// The guard for an update to a release. `requires_core`: the release needs the core.
/// `core_installed`: a `herdr-core` is on this computer. `herdr1`: a `herdr` (herdr 1) is.
pub fn guard(requires_core: bool, core_installed: bool, herdr1: bool) -> Guard {
    match (requires_core, core_installed) {
        (false, _) => Guard::Proceed,
        (true, false) => Guard::InstallCoreFirst { herdr1 },
        (true, true) => Guard::EnsureCore,
    }
}

/// The text for the user when the update moves a herdr 1 computer to Herdr 2.
pub const HERDR1_NOTICE: &str = "This herdlingd works only with Herdr 2 (herdr-core). The update installs herdr-core first. \
herdr 1 sessions do not show in Herdling any more.";

/// The notice for a guard, if any.
pub fn notice(g: Guard) -> Option<&'static str> {
    match g {
        Guard::InstallCoreFirst { herdr1: true } => Some(HERDR1_NOTICE),
        _ => None,
    }
}
