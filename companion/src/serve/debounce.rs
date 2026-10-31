//! Turns agent status changes into push notices, debounced per pane. Pure: the
//! caller passes the time.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::types::AgentStatus;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Notice {
    /// The agent stopped working (`working → idle | done`).
    Finished,
    /// The agent waits for the user (`→ blocked`).
    NeedsYou,
}

impl Notice {
    /// True while `status` still justifies the notice.
    fn holds(self, status: AgentStatus) -> bool {
        match self {
            Notice::Finished => matches!(status, AgentStatus::Idle | AgentStatus::Done),
            Notice::NeedsYou => status == AgentStatus::Blocked,
        }
    }
}

#[derive(Default)]
struct Pane {
    /// `None` until the first status is seen.
    status: Option<AgentStatus>,
    pending: Option<(Notice, Instant)>,
}

/// Last status and pending notice per pane. A notice is due `window` after the
/// change that caused it, unless a later change cancels it.
pub struct Debouncer {
    window: Duration,
    panes: HashMap<String, Pane>,
}

impl Debouncer {
    pub fn new(window: Duration) -> Self {
        Debouncer { window, panes: HashMap::new() }
    }

    /// Records the status of `pane`. The first status of a pane has no "from", so it
    /// only sets the baseline.
    pub fn observe(&mut self, pane: &str, status: AgentStatus, now: Instant) {
        let p = self.panes.entry(pane.to_string()).or_default();
        let Some(from) = p.status.replace(status) else { return };
        if from == status {
            return;
        }
        let deadline = now + self.window;
        if status == AgentStatus::Blocked {
            p.pending = Some((Notice::NeedsYou, deadline));
        } else if from == AgentStatus::Working && Notice::Finished.holds(status) {
            p.pending = Some((Notice::Finished, deadline));
        } else if p.pending.is_some_and(|(n, _)| !n.holds(status)) {
            p.pending = None;
        }
    }

    /// The last status seen for `pane`.
    pub fn status(&self, pane: &str) -> Option<AgentStatus> {
        self.panes.get(pane).and_then(|p| p.status)
    }

    /// Notices whose deadline is at or before `now`. Removes the returned entries.
    pub fn due(&mut self, now: Instant) -> Vec<(String, Notice)> {
        let mut out = vec![];
        for (pane, p) in &mut self.panes {
            if let Some((notice, at)) = p.pending {
                if at <= now {
                    p.pending = None;
                    out.push((pane.clone(), notice));
                }
            }
        }
        out
    }

    /// The earliest pending deadline.
    pub fn next_deadline(&self) -> Option<Instant> {
        self.panes.values().filter_map(|p| p.pending.map(|(_, at)| at)).min()
    }

    /// Drops the status and any pending notice of `pane` (for example, the pane closed).
    pub fn forget(&mut self, pane: &str) {
        self.panes.remove(pane);
    }
}
