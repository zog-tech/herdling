//! Tells if the user is at the computer, from herdr focus changes. Pure: the caller
//! passes the time.

use std::time::{Duration, Instant};

use crate::types::AgentStatus;

/// The desk counts as active for this long after the last activity.
pub const DESK_WINDOW: Duration = Duration::from_secs(5 * 60);
/// A start of work that follows phone input this closely came from the phone, not the desk.
pub const PHONE_INPUT_WINDOW: Duration = Duration::from_secs(15);

/// Last desk activity and the pane that has the focus in herdr.
#[derive(Default)]
pub struct Desk {
    last_active: Option<Instant>,
    focused_pane: Option<String>,
}

impl Desk {
    /// True when the last activity is less than `DESK_WINDOW` before `now`.
    pub fn active(&self, now: Instant) -> bool {
        self.last_active.is_some_and(|at| now.saturating_duration_since(at) < DESK_WINDOW)
    }

    /// Records desk activity at `now`.
    pub fn touch(&mut self, now: Instant) {
        self.last_active = Some(now);
    }

    /// Sets the focused pane without activity (for example from a snapshot).
    pub fn set_focused(&mut self, pane: Option<&str>) {
        self.focused_pane = pane.map(String::from);
    }

    /// The user focused `pane` in a herdr client.
    pub fn focus(&mut self, pane: &str, now: Instant) {
        self.set_focused(Some(pane));
        self.touch(now);
    }

    pub fn focused(&self) -> Option<&str> {
        self.focused_pane.as_deref()
    }

    /// The agent status of `pane` changed from `from` to `to`. The focused pane that starts
    /// to work means the user typed into it at the desk, unless the phone sent input to it
    /// `phone_input_ago` before (less than `PHONE_INPUT_WINDOW`).
    pub fn agent_status(
        &mut self,
        pane: &str,
        from: Option<AgentStatus>,
        to: AgentStatus,
        phone_input_ago: Option<Duration>,
        now: Instant,
    ) {
        if self.focused() != Some(pane) || to != AgentStatus::Working {
            return;
        }
        if from.is_none_or(|f| f == AgentStatus::Working) {
            return;
        }
        if phone_input_ago.is_some_and(|ago| ago < PHONE_INPUT_WINDOW) {
            return;
        }
        self.touch(now);
    }
}
