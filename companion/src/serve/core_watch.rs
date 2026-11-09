//! Watches the agent statuses of herdr-core (Herdr 2) and sends pushes through the same
//! debouncer and push pipeline as herdr 1. herdlingd only joins a running core: when there is
//! none, it tries again with backoff and logs only when the state changes.
//!
//! The quiet-at-the-computer rule needs desk activity, and the core does not report it. So a
//! core push is never held back as "at the computer".

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::debounce::{Debouncer, Notice};
use super::watch::deliver;
use super::ServeCtx;
use crate::config;
use crate::core::client::{Client, CoreError, Notice as CoreNotice, Subscription, GENERATION};
use crate::core::endpoint::CoreSocket;
use crate::core::project;
use crate::core::tracker::{Effect, Tracker};
use crate::push;
use crate::rpc::HERDR_TIMEOUT;

/// Waits between reconnect attempts, in seconds. The last value repeats.
const BACKOFF: [u64; 6] = [1, 2, 4, 8, 16, 30];
/// Bound for one Expo push request.
const PUSH_TIMEOUT: Duration = Duration::from_secs(10);
/// Notifications queued between the core stream and the watcher loop.
const QUEUE: usize = 1024;

/// Runs forever. Without a core socket it waits forever.
pub async fn watch(ctx: &ServeCtx) {
    let Some(sock) = ctx.core_socket.clone() else { return std::future::pending().await };
    let client = reqwest::Client::builder().timeout(PUSH_TIMEOUT).build().unwrap_or_default();
    let mut failures = 0usize;
    let mut reported = false;
    loop {
        match connect(&sock).await {
            Ok((terminals, sub)) => {
                failures = 0;
                reported = false;
                eprintln!("herdlingd serve: joined herdr-core");
                run(ctx, &client, &sock, terminals, sub).await;
                eprintln!("herdlingd serve: herdr-core closed the event stream, reconnecting");
            }
            Err(e) => {
                if !reported {
                    eprintln!("herdlingd serve: herdr-core: {e}");
                    reported = true;
                }
            }
        }
        let secs = BACKOFF[failures.min(BACKOFF.len() - 1)];
        failures += 1;
        tokio::time::sleep(Duration::from_secs(secs)).await;
    }
}

/// `hello` (the generation must be ours), then `events.subscribe`. Returns the snapshot
/// terminals and the subscription.
async fn connect(sock: &CoreSocket) -> Result<(Vec<Value>, Subscription), CoreError> {
    let mut c = Client::connect(&sock.current(), HERDR_TIMEOUT).await?;
    let hello = c.hello().await?;
    let generation = hello.get("generation").and_then(Value::as_u64).unwrap_or(0);
    if generation != GENERATION {
        return Err(CoreError::Remote {
            kind: "unsupported_generation".into(),
            message: format!("herdr-core speaks protocol generation {generation}; herdlingd speaks {GENERATION}"),
        });
    }
    let (snap, sub) = c.subscribe(json!({})).await?;
    Ok((terminals_of(&snap), sub))
}

fn terminals_of(snap: &Value) -> Vec<Value> {
    snap.get("terminals").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Applies tracker effects to the debouncer.
fn apply(debouncer: &mut Debouncer, effects: Vec<Effect>, now: Instant) {
    for e in effects {
        match e {
            Effect::Observe(pane, status) => debouncer.observe(&pane, status, now),
            Effect::Forget(pane) => debouncer.forget(&pane),
        }
    }
}

/// Reads one subscription until it ends. A new debouncer per connection: the core can have
/// restarted, so the snapshot is a new baseline. After `missed` (the same core), the snapshot
/// reconciles the debouncer: a status that changed meanwhile gives its notice.
async fn run(ctx: &ServeCtx, client: &reqwest::Client, sock: &CoreSocket, terminals: Vec<Value>, mut sub: Subscription) {
    let mut tracker = Tracker::default();
    let mut debouncer = Debouncer::new(ctx.debounce);
    apply(&mut debouncer, tracker.reset(&terminals), Instant::now());
    // `Subscription::next` is not safe to cancel, so a task reads it.
    let (tx, mut rx) = mpsc::channel::<CoreNotice>(QUEUE);
    let reader = tokio::spawn(async move {
        while let Some(n) = sub.next().await {
            if tx.send(n).await.is_err() {
                return;
            }
        }
    });
    loop {
        let wait = async {
            match debouncer.next_deadline() {
                Some(at) => tokio::time::sleep_until(tokio::time::Instant::from_std(at)).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            n = rx.recv() => match n {
                Some(CoreNotice::Event(params)) => {
                    let effects = tracker.apply(&params);
                    apply(&mut debouncer, effects, Instant::now());
                }
                Some(CoreNotice::Missed(snap)) => {
                    let effects = tracker.reset(&terminals_of(&snap));
                    let open = tracker.panes();
                    debouncer.retain(|p| open.iter().any(|o| o == p));
                    apply(&mut debouncer, effects, Instant::now());
                }
                Some(CoreNotice::Heartbeat(_)) => {}
                None => break,
            },
            _ = wait => {}
        }
        for (pane, notice) in debouncer.due(Instant::now()) {
            send_notice(ctx, client, sock, &tracker, &pane, notice).await;
        }
    }
    reader.abort();
}

/// Sends `notice` for the core pane `pane` to every device that wants it.
async fn send_notice(ctx: &ServeCtx, client: &reqwest::Client, sock: &CoreSocket, tracker: &Tracker, pane: &str, notice: Notice) {
    let cfg = match config::load(&ctx.config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("herdlingd serve: config: {e:#}");
            return;
        }
    };
    let (title, body) = tracker.record(pane).map_or_else(|| (pane.to_string(), String::new()), project::push_text);
    let choice = match notice {
        Notice::NeedsYou if cfg.devices.iter().any(|d| d.can(config::CHOICE_ACTIONS)) => choice_of(sock, pane).await,
        _ => None,
    };
    let msgs = push::messages(&cfg, notice, pane, &title, &body, false, choice.as_ref());
    deliver(ctx, client, &msgs).await;
}

/// The Yes and No options of the permission menu on the screen of `pane`, if it has one.
async fn choice_of(sock: &CoreSocket, pane: &str) -> Option<crate::choices::PushChoice> {
    let (text, _) = crate::core::live::read_text(sock, HERDR_TIMEOUT, pane, 0).await.ok()?;
    let choice = crate::choices::yes_no(&crate::choices::parse_choices(&text), 0)?;
    Some(crate::choices::PushChoice { question: crate::choices::menu_question(&text), ..choice })
}
