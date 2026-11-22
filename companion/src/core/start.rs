//! The steps of `session.start` on the core, as a pure state machine: start the terminal, wait
//! until the agent reports a status, send the first prompt. `core::live` runs the effects and
//! feeds the results back.
//!
//! For bash, zsh and ksh the new terminal runs the agent command itself (`Plan::argv`), so no
//! key can go to a startup file of the shell. For other shells herdlingd starts the shell and
//! types the command once the shell is ready (`core::typing::shell_ready`).
//!
//! Once the agent command is typed, the agent runs: a failed or late prompt does not fail the
//! start. It comes back as `prompt_error`, so the app opens the agent and offers the prompt again.

use std::time::Duration;

use serde_json::Value;

use super::project::agent_status;

/// What one start does.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// The agent command line (`core::actions::agent_line`).
    pub line: String,
    /// The program of the new terminal when it runs the agent itself
    /// (`core::actions::agent_argv`). None: start a shell and type `line` into it.
    pub argv: Option<Vec<String>>,
    /// The first prompt, if any.
    pub prompt: Option<String>,
    /// Most `terminal.get` checks before the prompt is given up.
    pub max_tries: u32,
    /// Wait between two checks.
    pub wait: Duration,
}

/// Checks for a ready agent: 120 × 500 ms = 60 s, longer than an agent boot.
pub const MAX_TRIES: u32 = 120;
pub const WAIT: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, PartialEq)]
pub enum State {
    /// The shell is being started.
    Shell,
    /// The agent command is being typed into the shell `addr`.
    Command { addr: String },
    /// Waiting for the agent in `addr` to report a status (check number `tries`).
    Waiting { addr: String, tries: u32 },
    /// The first prompt is being sent.
    Prompt { addr: String },
    Done,
}

/// The result of the last effect.
#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    /// The shell runs as terminal `addr`.
    Ran(String),
    /// The agent command was typed.
    Typed,
    /// The terminal record of a check.
    Record(Value),
    /// The prompt was sent.
    Sent,
    /// The last effect failed with this message.
    Failed(String),
}

/// How the start ended.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// The agent runs in `addr`. `prompt_error` says why the first prompt did not go in.
    Started { addr: String, prompt_error: Option<String> },
    /// Nothing runs: the error.
    Failed(String),
}

/// What the caller does next.
#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    /// Start the terminal (the place and folder are the caller's), with `Plan::argv` as its
    /// program when it has one.
    Run,
    Type { addr: String, line: String },
    Wait(Duration),
    Get(String),
    Send { addr: String, text: String },
    /// Kill the new shell: the agent did not start, so do not leave an empty tab.
    Kill(String),
    Finish(Outcome),
}

/// The first state and effect.
pub fn begin() -> (State, Vec<Effect>) {
    (State::Shell, vec![Effect::Run])
}

fn started(addr: String, prompt_error: Option<String>) -> Vec<Effect> {
    vec![Effect::Finish(Outcome::Started { addr, prompt_error })]
}

/// The next state and effects after `input` in `state`.
pub fn step(state: State, input: Input, plan: &Plan) -> (State, Vec<Effect>) {
    match (state, input) {
        // The terminal runs the agent itself: nothing to type.
        (State::Shell, Input::Ran(addr)) if plan.argv.is_some() => step(State::Command { addr }, Input::Typed, plan),
        (State::Shell, Input::Ran(addr)) => {
            let line = plan.line.clone();
            (State::Command { addr: addr.clone() }, vec![Effect::Type { addr, line }])
        }
        (State::Shell, Input::Failed(e)) => (State::Done, vec![Effect::Finish(Outcome::Failed(e))]),
        (State::Command { addr }, Input::Typed) => match &plan.prompt {
            Some(_) => (State::Waiting { addr: addr.clone(), tries: 1 }, vec![Effect::Get(addr)]),
            None => (State::Done, started(addr, None)),
        },
        (State::Command { addr }, Input::Failed(e)) => (State::Done, vec![Effect::Kill(addr), Effect::Finish(Outcome::Failed(e))]),
        (State::Waiting { addr, tries }, Input::Record(t)) => {
            if agent_status(&t).is_some() {
                let text = plan.prompt.clone().unwrap_or_default();
                return (State::Prompt { addr: addr.clone() }, vec![Effect::Send { addr, text }]);
            }
            if tries >= plan.max_tries {
                let why = "the agent did not report that it is ready, so the prompt was not sent".to_string();
                return (State::Done, started(addr, Some(why)));
            }
            (State::Waiting { addr: addr.clone(), tries: tries + 1 }, vec![Effect::Wait(plan.wait), Effect::Get(addr)])
        }
        (State::Waiting { addr, .. } | State::Prompt { addr }, Input::Failed(e)) => (State::Done, started(addr, Some(e))),
        (State::Prompt { addr }, Input::Sent) => (State::Done, started(addr, None)),
        (State::Done, _) => (State::Done, vec![]),
        // An input that the state does not expect: stop, and kill a new shell that has no agent yet.
        (state, input) => {
            let why = Effect::Finish(Outcome::Failed(format!("internal: unexpected step {input:?}")));
            match state {
                State::Command { addr } => (State::Done, vec![Effect::Kill(addr), why]),
                State::Waiting { addr, .. } | State::Prompt { addr } => (State::Done, started(addr, Some(format!("internal: unexpected step {input:?}")))),
                _ => (State::Done, vec![why]),
            }
        }
    }
}
