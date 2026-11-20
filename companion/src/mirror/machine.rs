//! The state machine of one mirror session. Pure: [`step`] takes the state, an input and the
//! time, and gives the new state and the effects. `mirror::session` runs the effects.
//!
//! ```text
//! Waiting ──viewer joins──▶ Starting(gen) ──source ready──▶ Streaming(gen)
//! Streaming ──last viewer leaves──▶ Grace(gen) ──viewer joins──▶ Streaming(gen)
//! Grace ──grace time passes──▶ Waiting (stop the source)
//! Starting/Streaming ──source ends──▶ Waiting (error to the viewers)
//! Waiting ──no viewer for SERVER_IDLE──▶ Stopped
//! any ──Stop──▶ Stopped
//! ```
//!
//! Each source attempt has a generation number. An input of an old generation is ignored.

use std::time::{Duration, Instant};

/// The source keeps running this long after the last viewer leaves.
pub const GRACE: Duration = Duration::from_secs(10);
/// The server closes when no viewer is connected for this long.
pub const SERVER_IDLE: Duration = Duration::from_secs(5 * 60);

/// Which source the session uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// H.264 video (scrcpy or `idb video-stream`).
    Video,
    /// Screenshots, again and again.
    Shots,
}

/// Where the session is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// No source runs. `since`: the time the session came here.
    Waiting { since: Instant },
    /// The source of `gen` starts.
    Starting { gen: u64 },
    /// The source of `gen` sends frames.
    Streaming { gen: u64 },
    /// No viewer; the source of `gen` stops at `until` unless a viewer joins.
    Grace { gen: u64, until: Instant },
    /// The session ended. The server closes.
    Stopped,
}

/// The whole state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub phase: Phase,
    pub mode: Mode,
    /// Connected viewers.
    pub viewers: usize,
    /// The last generation given to a source.
    pub gen: u64,
}

impl State {
    pub fn new(mode: Mode, now: Instant) -> State {
        State { phase: Phase::Waiting { since: now }, mode, viewers: 0, gen: 0 }
    }
}

/// What happens to the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    /// A viewer connected. `video`: it can decode video.
    Joined { video: bool },
    /// A viewer disconnected.
    Left,
    /// The source of `gen` sent its first frame.
    Ready { gen: u64 },
    /// The source of `gen` ended. `fallback`: it failed before its first frame and screenshots
    /// can take over. `error`: the reason, None for a normal end.
    Ended { gen: u64, error: Option<String>, fallback: bool },
    /// The timer.
    Tick,
    /// `mirror.stop`, or the rpc process ends.
    Stop,
}

/// What the runner must do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    StartSource { gen: u64, mode: Mode },
    StopSource { gen: u64 },
    /// Send the state to the viewers.
    Announce,
    /// Send an error to the viewers.
    Error(String),
    /// Close the server.
    Shutdown,
}

/// The result of one [`step`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub state: State,
    pub effects: Vec<Effect>,
}

fn start(s: &mut State, fx: &mut Vec<Effect>) {
    s.gen += 1;
    s.phase = Phase::Starting { gen: s.gen };
    fx.push(Effect::StartSource { gen: s.gen, mode: s.mode });
    fx.push(Effect::Announce);
}

/// The generation of the running source, if any.
pub fn running_gen(p: &Phase) -> Option<u64> {
    match *p {
        Phase::Starting { gen } | Phase::Streaming { gen } | Phase::Grace { gen, .. } => Some(gen),
        Phase::Waiting { .. } | Phase::Stopped => None,
    }
}

/// One transition. Pure.
pub fn step(state: &State, input: Input, now: Instant) -> Step {
    let mut s = state.clone();
    let mut fx = Vec::new();
    if s.phase == Phase::Stopped {
        // A stopped session takes nothing. A viewer that still leaves only counts down.
        if input == Input::Left {
            s.viewers = s.viewers.saturating_sub(1);
        }
        return Step { state: s, effects: fx };
    }
    match input {
        Input::Joined { video } => {
            s.viewers += 1;
            // A viewer that cannot decode video moves the whole session to screenshots.
            let switch = !video && s.mode == Mode::Video;
            if switch {
                s.mode = Mode::Shots;
            }
            match s.phase {
                Phase::Waiting { .. } => start(&mut s, &mut fx),
                Phase::Grace { gen, .. } | Phase::Streaming { gen } | Phase::Starting { gen } if switch => {
                    fx.push(Effect::StopSource { gen });
                    start(&mut s, &mut fx);
                }
                Phase::Grace { gen, .. } => {
                    s.phase = Phase::Streaming { gen };
                    fx.push(Effect::Announce);
                }
                Phase::Starting { .. } | Phase::Streaming { .. } => fx.push(Effect::Announce),
                Phase::Stopped => {}
            }
        }
        Input::Left => {
            s.viewers = s.viewers.saturating_sub(1);
            if s.viewers == 0 {
                match s.phase {
                    Phase::Starting { gen } | Phase::Streaming { gen } => s.phase = Phase::Grace { gen, until: now + GRACE },
                    Phase::Waiting { .. } => s.phase = Phase::Waiting { since: now },
                    _ => {}
                }
            }
        }
        Input::Ready { gen } => {
            if s.phase == (Phase::Starting { gen }) {
                s.phase = Phase::Streaming { gen };
                fx.push(Effect::Announce);
            }
        }
        Input::Ended { gen, error, fallback } => {
            if running_gen(&s.phase) != Some(gen) {
                return Step { state: s, effects: fx };
            }
            let before_ready = matches!(s.phase, Phase::Starting { .. });
            if fallback && before_ready && s.mode == Mode::Video {
                // Video did not start: screenshots take over at once.
                s.mode = Mode::Shots;
                if s.viewers > 0 {
                    start(&mut s, &mut fx);
                    return Step { state: s, effects: fx };
                }
            }
            s.phase = Phase::Waiting { since: now };
            fx.push(Effect::Error(error.unwrap_or_else(|| "The device stream ended.".into())));
            fx.push(Effect::Announce);
        }
        Input::Tick => match s.phase {
            Phase::Grace { gen, until } if now >= until => {
                s.phase = Phase::Waiting { since: now };
                fx.push(Effect::StopSource { gen });
            }
            Phase::Waiting { since } if s.viewers == 0 && now.duration_since(since) >= SERVER_IDLE => {
                s.phase = Phase::Stopped;
                fx.push(Effect::Shutdown);
            }
            _ => {}
        },
        Input::Stop => {
            if let Some(gen) = running_gen(&s.phase) {
                fx.push(Effect::StopSource { gen });
            }
            s.phase = Phase::Stopped;
            fx.push(Effect::Shutdown);
        }
    }
    Step { state: s, effects: fx }
}
