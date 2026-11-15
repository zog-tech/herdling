//! The attach stream state machine of a Herdr 2 pane (`core::attach`).

use std::time::{Duration, Instant};

use herdlingd::core::attach::{backoff, start, step, wake, Config, Effect, Ending, Failure, Input, State, MAX_RETRIES};

const CFG: Config = Config { interval: Duration::from_millis(80) };

fn ms(t0: Instant, n: u64) -> Instant {
    t0 + Duration::from_millis(n)
}

fn live(gen: u64, last_emit: Option<Instant>) -> State {
    State::Live { gen, channel: 1, dirty: false, last_emit }
}

fn gone() -> Failure {
    Failure::Gone { code: "pane_not_found".into(), message: "no terminal t1".into() }
}

#[test]
fn backoff_doubles_up_to_four_seconds() {
    let got: Vec<u64> = (1..=7).map(|n| backoff(n).as_millis() as u64).collect();
    assert_eq!(got, vec![250, 500, 1000, 2000, 4000, 4000, 4000]);
}

#[test]
fn attaching_then_attached_resets_the_emulator() {
    let t0 = Instant::now();
    let s = step(start(1), Input::Attached { gen: 1, channel: 3, cols: 80, rows: 24 }, t0, &CFG);
    assert_eq!(s.state, State::Live { gen: 1, channel: 3, dirty: false, last_emit: None });
    assert_eq!(s.effects, vec![Effect::Reset { cols: 80, rows: 24 }]);
}

#[test]
fn attaching_gone_ends_with_the_error() {
    let s = step(start(1), Input::Failed { gen: 1, failure: gone() }, Instant::now(), &CFG);
    assert_eq!(s.state, State::Ended);
    assert_eq!(s.effects, vec![Effect::End(Ending::Error { code: "pane_not_found".into(), message: "no terminal t1".into() })]);
}

#[test]
fn attaching_unavailable_waits_then_retries_with_a_new_generation() {
    let t0 = Instant::now();
    let s = step(start(1), Input::Failed { gen: 1, failure: Failure::Unavailable("x".into()) }, t0, &CFG);
    assert_eq!(s.state, State::Waiting { gen: 1, failures: 1, until: ms(t0, 250) });
    assert_eq!(wake(&s.state, &CFG), Some(ms(t0, 250)));
    // Too early: nothing.
    let early = step(s.state.clone(), Input::Tick, ms(t0, 100), &CFG);
    assert_eq!(early.state, s.state);
    assert!(early.effects.is_empty());
    let s = step(s.state, Input::Tick, ms(t0, 250), &CFG);
    assert_eq!(s.state, State::Attaching { gen: 2, failures: 1 });
    assert_eq!(s.effects, vec![Effect::Connect { gen: 2 }]);
}

#[test]
fn too_many_failures_end_with_closed() {
    let t0 = Instant::now();
    let s = step(State::Attaching { gen: 6, failures: MAX_RETRIES }, Input::Closed { gen: 6 }, t0, &CFG);
    assert_eq!(s.state, State::Ended);
    assert_eq!(s.effects, vec![Effect::End(Ending::Closed)]);
}

#[test]
fn first_data_emits_at_once_and_gives_credit() {
    let t0 = Instant::now();
    let s = step(live(1, None), Input::Data { gen: 1, bytes: b"abc".to_vec() }, t0, &CFG);
    assert_eq!(s.effects, vec![Effect::Feed(b"abc".to_vec()), Effect::Credit { channel: 1, n: 3 }, Effect::Emit]);
    assert_eq!(s.state, live(1, Some(t0)));
    assert_eq!(wake(&s.state, &CFG), None);
}

#[test]
fn data_within_the_interval_waits_for_a_tick() {
    let t0 = Instant::now();
    let s = step(live(1, Some(t0)), Input::Data { gen: 1, bytes: b"x".to_vec() }, ms(t0, 10), &CFG);
    assert_eq!(s.effects, vec![Effect::Feed(b"x".to_vec()), Effect::Credit { channel: 1, n: 1 }]);
    assert_eq!(wake(&s.state, &CFG), Some(ms(t0, 80)));
    let early = step(s.state.clone(), Input::Tick, ms(t0, 50), &CFG);
    assert!(early.effects.is_empty());
    let s = step(s.state, Input::Tick, ms(t0, 80), &CFG);
    assert_eq!(s.effects, vec![Effect::Emit]);
    assert_eq!(s.state, live(1, Some(ms(t0, 80))));
    // Not dirty: a tick does nothing.
    let s = step(s.state, Input::Tick, ms(t0, 500), &CFG);
    assert!(s.effects.is_empty());
}

#[test]
fn resize_resizes_and_emits() {
    let t0 = Instant::now();
    let s = step(live(1, None), Input::Resize { gen: 1, cols: 45, rows: 30 }, t0, &CFG);
    assert_eq!(s.effects, vec![Effect::Resize { cols: 45, rows: 30 }, Effect::Emit]);
}

#[test]
fn live_closed_waits_and_counts_from_one() {
    let t0 = Instant::now();
    let s = step(live(3, Some(t0)), Input::Closed { gen: 3 }, t0, &CFG);
    assert_eq!(s.state, State::Waiting { gen: 3, failures: 1, until: ms(t0, 250) });
    assert!(s.effects.is_empty());
}

#[test]
fn live_gone_ends_with_the_error() {
    let s = step(live(1, None), Input::Failed { gen: 1, failure: gone() }, Instant::now(), &CFG);
    assert_eq!(s.state, State::Ended);
    assert!(matches!(s.effects[..], [Effect::End(Ending::Error { .. })]));
}

#[test]
fn a_stale_generation_changes_nothing() {
    let t0 = Instant::now();
    for state in [live(2, None), State::Waiting { gen: 2, failures: 1, until: t0 }, State::Attaching { gen: 2, failures: 0 }] {
        for input in [
            Input::Data { gen: 1, bytes: b"old".to_vec() },
            Input::Closed { gen: 1 },
            Input::Attached { gen: 1, channel: 9, cols: 1, rows: 1 },
            Input::Failed { gen: 1, failure: gone() },
            Input::Resize { gen: 1, cols: 1, rows: 1 },
        ] {
            let s = step(state.clone(), input, t0, &CFG);
            assert_eq!(s.state, state);
            assert!(s.effects.is_empty());
        }
    }
}

#[test]
fn impossible_inputs_change_nothing() {
    let t0 = Instant::now();
    // Data while attaching, attached while live, data while waiting.
    let s = step(start(1), Input::Data { gen: 1, bytes: b"x".to_vec() }, t0, &CFG);
    assert_eq!((s.state, s.effects.len()), (start(1), 0));
    let s = step(live(1, None), Input::Attached { gen: 1, channel: 5, cols: 1, rows: 1 }, t0, &CFG);
    assert_eq!((s.state, s.effects.len()), (live(1, None), 0));
    let w = State::Waiting { gen: 1, failures: 1, until: ms(t0, 250) };
    let s = step(w.clone(), Input::Data { gen: 1, bytes: b"x".to_vec() }, t0, &CFG);
    assert_eq!((s.state, s.effects.len()), (w, 0));
}

#[test]
fn stop_ends_from_every_state_and_ended_takes_nothing() {
    let t0 = Instant::now();
    for state in [start(1), live(1, None), State::Waiting { gen: 1, failures: 1, until: t0 }] {
        let s = step(state, Input::Stop, t0, &CFG);
        assert_eq!(s.state, State::Ended);
        assert!(s.effects.is_empty());
    }
    let s = step(State::Ended, Input::Tick, t0, &CFG);
    assert_eq!((s.state, s.effects.len()), (State::Ended, 0));
    assert_eq!(wake(&State::Ended, &CFG), None);
}
