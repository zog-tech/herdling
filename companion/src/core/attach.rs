//! The life of one `pane.watch` stream on a Herdr 2 terminal: attach, frames, close and
//! reconnect. Pure: [`step`] takes the state, an input and the time, and gives the new state and
//! the effects. `core::term_watch` runs the effects (the socket, the emulator, the events).
//!
//! Each attach attempt has a generation number. An input of an older attempt changes nothing.

use std::time::{Duration, Instant};

/// Failed attempts in a row before the stream ends with `{closed: true}`.
pub const MAX_RETRIES: u32 = 5;

/// The wait before attempt number `failures + 1`: 250 ms, doubled for each failure, at most 4 s.
pub fn backoff(failures: u32) -> Duration {
    let ms = 250u64.saturating_mul(1 << failures.saturating_sub(1).min(4));
    Duration::from_millis(ms.min(4000))
}

#[derive(Debug, Clone, PartialEq)]
pub enum State {
    /// A connect and `terminal.attach` of attempt `gen` runs.
    Attaching { gen: u64, failures: u32 },
    /// The stream of attempt `gen` is open on `channel`. `dirty`: the screen changed since the
    /// last emit.
    Live { gen: u64, channel: u32, dirty: bool, last_emit: Option<Instant> },
    /// Attempt `gen` failed or closed; the next attempt starts at `until`.
    Waiting { gen: u64, failures: u32, until: Instant },
    Ended,
}

/// Why an attempt failed.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// The terminal is not there or finished: the stream ends with this error.
    Gone { code: String, message: String },
    /// The core did not answer, or the terminal waits for a new shell: try again.
    Unavailable(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    Attached { gen: u64, channel: u32, cols: u16, rows: u16 },
    Failed { gen: u64, failure: Failure },
    /// A RESIZE frame.
    Resize { gen: u64, cols: u16, rows: u16 },
    /// A DATA frame on the stream channel.
    Data { gen: u64, bytes: Vec<u8> },
    /// A CLOSE frame, the end of the connection, or an emulator failure.
    Closed { gen: u64 },
    /// Time passed.
    Tick,
    /// The app stopped the stream.
    Stop,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Ending {
    Error { code: String, message: String },
    Closed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    /// Open attempt `gen`: connect, `hello`, `terminal.attach`.
    Connect { gen: u64 },
    /// A new, empty emulator of this size.
    Reset { cols: u16, rows: u16 },
    Feed(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    /// Give the core credit for `n` bytes of `channel`.
    Credit { channel: u32, n: u32 },
    /// Render the screen and offer it to the app.
    Emit,
    End(Ending),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub state: State,
    pub effects: Vec<Effect>,
}

#[derive(Debug, Clone, Copy)]
pub struct Config {
    /// The shortest time between two emits.
    pub interval: Duration,
}

/// The first state: attempt `gen` runs (the caller opens it).
pub fn start(gen: u64) -> State {
    State::Attaching { gen, failures: 0 }
}

/// When the driver must send [`Input::Tick`], if at all.
pub fn wake(state: &State, cfg: &Config) -> Option<Instant> {
    match state {
        State::Live { dirty: true, last_emit: Some(t), .. } => Some(*t + cfg.interval),
        State::Waiting { until, .. } => Some(*until),
        _ => None,
    }
}

fn gen_of(input: &Input) -> Option<u64> {
    match input {
        Input::Attached { gen, .. }
        | Input::Failed { gen, .. }
        | Input::Resize { gen, .. }
        | Input::Data { gen, .. }
        | Input::Closed { gen } => Some(*gen),
        Input::Tick | Input::Stop => None,
    }
}

fn state_gen(state: &State) -> Option<u64> {
    match state {
        State::Attaching { gen, .. } | State::Live { gen, .. } | State::Waiting { gen, .. } => Some(*gen),
        State::Ended => None,
    }
}

fn keep(state: State) -> Step {
    Step { state, effects: vec![] }
}

/// Attempt `gen` failed for the `failures`-th time in a row.
fn retry(gen: u64, failures: u32, now: Instant) -> Step {
    if failures > MAX_RETRIES {
        return Step { state: State::Ended, effects: vec![Effect::End(Ending::Closed)] };
    }
    keep(State::Waiting { gen, failures, until: now + backoff(failures) })
}

fn due(last_emit: Option<Instant>, now: Instant, cfg: &Config) -> bool {
    last_emit.is_none_or(|t| now.duration_since(t) >= cfg.interval)
}

/// The screen changed: emit now when the interval passed, else mark it dirty for a later tick.
fn changed(gen: u64, channel: u32, last_emit: Option<Instant>, mut effects: Vec<Effect>, now: Instant, cfg: &Config) -> Step {
    let (dirty, last_emit) = if due(last_emit, now, cfg) {
        effects.push(Effect::Emit);
        (false, Some(now))
    } else {
        (true, last_emit)
    };
    Step { state: State::Live { gen, channel, dirty, last_emit }, effects }
}

pub fn step(state: State, input: Input, now: Instant, cfg: &Config) -> Step {
    if state == State::Ended {
        return keep(state);
    }
    if input == Input::Stop {
        return keep(State::Ended);
    }
    if let Some(g) = gen_of(&input) {
        if Some(g) != state_gen(&state) {
            return keep(state);
        }
    }
    match (state, input) {
        (State::Attaching { gen, .. }, Input::Attached { channel, cols, rows, .. }) => Step {
            state: State::Live { gen, channel, dirty: false, last_emit: None },
            effects: vec![Effect::Reset { cols, rows }],
        },
        (State::Attaching { .. } | State::Live { .. }, Input::Failed { failure: Failure::Gone { code, message }, .. }) => Step {
            state: State::Ended,
            effects: vec![Effect::End(Ending::Error { code, message })],
        },
        (State::Attaching { gen, failures }, Input::Failed { failure: Failure::Unavailable(_), .. } | Input::Closed { .. }) => {
            retry(gen, failures + 1, now)
        }
        // A stream that lived starts the count again.
        (State::Live { gen, .. }, Input::Failed { failure: Failure::Unavailable(_), .. } | Input::Closed { .. }) => retry(gen, 1, now),
        (State::Live { gen, channel, last_emit, .. }, Input::Data { bytes, .. }) => {
            let n = bytes.len() as u32;
            changed(gen, channel, last_emit, vec![Effect::Feed(bytes), Effect::Credit { channel, n }], now, cfg)
        }
        (State::Live { gen, channel, last_emit, .. }, Input::Resize { cols, rows, .. }) => {
            changed(gen, channel, last_emit, vec![Effect::Resize { cols, rows }], now, cfg)
        }
        (State::Live { gen, channel, dirty: true, last_emit }, Input::Tick) if due(last_emit, now, cfg) => Step {
            state: State::Live { gen, channel, dirty: false, last_emit: Some(now) },
            effects: vec![Effect::Emit],
        },
        (State::Waiting { gen, failures, until }, Input::Tick) if now >= until => Step {
            state: State::Attaching { gen: gen + 1, failures },
            effects: vec![Effect::Connect { gen: gen + 1 }],
        },
        (state, _) => keep(state),
    }
}
