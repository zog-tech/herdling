use std::time::{Duration, Instant};

use zogsshd::serve::debounce::{Debouncer, Notice};
use zogsshd::types::AgentStatus::{self, Blocked, Done, Idle, Unknown, Working};

const WINDOW: Duration = Duration::from_secs(5);

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

fn run(steps: &[(&str, AgentStatus, u64)]) -> (Debouncer, Instant) {
    let t0 = Instant::now();
    let mut d = Debouncer::new(WINDOW);
    for (pane, status, at) in steps {
        d.observe(pane, *status, t0 + ms(*at));
    }
    (d, t0)
}

#[test]
fn working_to_idle_fires_after_window() {
    let (mut d, t0) = run(&[("p", Working, 0), ("p", Idle, 1000)]);
    assert_eq!(d.next_deadline(), Some(t0 + ms(6000)));
    assert_eq!(d.due(t0 + ms(5900)), vec![]);
    assert_eq!(d.due(t0 + ms(6000)), vec![("p".to_string(), Notice::Finished)]);
    assert_eq!(d.due(t0 + ms(20000)), vec![], "an entry is returned once");
    assert_eq!(d.next_deadline(), None);
}

#[test]
fn working_to_done_fires_finished() {
    let (mut d, t0) = run(&[("p", Working, 0), ("p", Done, 1000)]);
    assert_eq!(d.due(t0 + ms(6000)), vec![("p".to_string(), Notice::Finished)]);
}

#[test]
fn blocked_fires_needs_you() {
    let (mut d, t0) = run(&[("a", Working, 0), ("a", Blocked, 1000), ("b", Idle, 0), ("b", Blocked, 1000)]);
    let mut got = d.due(t0 + ms(6000));
    got.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(got, vec![("a".to_string(), Notice::NeedsYou), ("b".to_string(), Notice::NeedsYou)]);
}

#[test]
fn flip_back_within_window_sends_nothing() {
    let (mut d, t0) = run(&[("p", Working, 0), ("p", Blocked, 0), ("p", Working, 2000)]);
    assert_eq!(d.due(t0 + ms(10000)), vec![]);
    let (mut d, t0) = run(&[("p", Working, 0), ("p", Idle, 0), ("p", Working, 2000)]);
    assert_eq!(d.due(t0 + ms(10000)), vec![]);
}

#[test]
fn only_from_working_counts_as_finished() {
    let (mut d, t0) = run(&[
        ("a", Idle, 0),
        ("a", Idle, 1000),
        ("b", Unknown, 0),
        ("b", Idle, 1000),
        ("c", Blocked, 0),
        ("c", Idle, 1000),
    ]);
    assert_eq!(d.due(t0 + ms(10000)), vec![]);
}

#[test]
fn first_status_has_no_from() {
    let (mut d, t0) = run(&[("p", Idle, 0), ("q", Blocked, 0)]);
    assert_eq!(d.due(t0 + ms(10000)), vec![]);
}

#[test]
fn finished_survives_idle_to_done() {
    let (mut d, t0) = run(&[("p", Working, 0), ("p", Idle, 1000), ("p", Done, 2000)]);
    assert_eq!(d.due(t0 + ms(6000)), vec![("p".to_string(), Notice::Finished)]);
}

#[test]
fn forget_drops_pending() {
    let (mut d, t0) = run(&[("p", Working, 0), ("p", Idle, 1000)]);
    d.forget("p");
    assert_eq!(d.next_deadline(), None);
    assert_eq!(d.due(t0 + ms(10000)), vec![]);
    // The status is forgotten too: the next status has no "from".
    d.observe("p", Idle, t0 + ms(11000));
    assert_eq!(d.due(t0 + ms(20000)), vec![]);
}
