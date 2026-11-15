//! Watches the agent statuses of herdr-core (Herdr 2) and sends pushes through the debouncer
//! and the push pipeline. herdlingd only joins a running core: when there is none, it tries
//! again with backoff and logs only when the state changes.
//!
//! The quiet-at-the-computer rule needs desk activity, and the core does not report it. So a
//! push is never held back as "at the computer".

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::debounce::{Debouncer, Notice};
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

/// Sleeps until `at`, or forever when it is `None`.
async fn sleep_until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(tokio::time::Instant::from_std(at)).await,
        None => std::future::pending().await,
    }
}

/// The pane of a core `foreground` or `title` event of this machine: the program in the
/// foreground can have changed.
pub fn foreground_pane(params: &Value) -> Option<String> {
    if params.get("machine").is_some_and(|m| !m.is_null()) {
        return None;
    }
    let kind = params.get("type").and_then(Value::as_str)?;
    let addr = params.get("terminal").and_then(Value::as_str).filter(|a| !a.contains('/'))?;
    matches!(kind, "foreground" | "title").then(|| project::pane_id(addr))
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
    // Checks the Herdr 2 shell panes that the phone watches: every `POLL`, and early after a
    // `foreground` or `title` event of a watched pane (see `shell_watch::Nudge`).
    let mut shell_tick = tokio::time::interval(crate::shell_watch::POLL);
    shell_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut nudge = crate::shell_watch::Nudge::default();
    loop {
        let wait = sleep_until(debouncer.next_deadline());
        let nudge_wait = sleep_until(nudge.due());
        let mut shell_check = false;
        tokio::select! {
            n = rx.recv() => match n {
                Some(CoreNotice::Event(params)) => {
                    if let Some(pane) = foreground_pane(&params) {
                        nudge.pane_updated(&pane, Instant::now());
                    }
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
            _ = nudge_wait => {}
            _ = shell_tick.tick() => shell_check = true,
        }
        if shell_check || nudge.ready(Instant::now()) {
            // The core reports no desk activity, so a command push is never held back.
            if let Some(panes) = super::shells::poll(ctx, client, sock).await {
                nudge.set_watched(panes);
            }
            nudge.checked(Instant::now());
            shell_tick.reset();
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
    // The card name and group need the whole projection; without it the push uses the record alone.
    let placed = crate::core::live::projection(sock, HERDR_TIMEOUT).await.ok();
    let (title, body) = match (tracker.record(pane), placed.as_ref()) {
        (Some(t), Some(p)) => project::push_text_placed(t, p),
        (Some(t), None) => project::push_text(t),
        (None, _) => (pane.to_string(), String::new()),
    };
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

/// Sends `msgs` and removes the push tokens that Expo reports as no longer registered.
pub(super) async fn deliver(ctx: &ServeCtx, client: &reqwest::Client, msgs: &[push::PushMessage]) {
    if msgs.is_empty() {
        return;
    }
    let gone = match push::send(client, &ctx.push_url, msgs).await {
        Ok(gone) => gone,
        Err(e) => {
            eprintln!("herdlingd serve: push: {e:#}");
            return;
        }
    };
    if gone.is_empty() {
        return;
    }
    let path = ctx.config_path.clone();
    let cleared = tokio::task::spawn_blocking(move || {
        config::update(&path, |c| {
            for d in &mut c.devices {
                if d.expo_token.as_ref().is_some_and(|t| gone.contains(t)) {
                    d.expo_token = None;
                }
            }
        })
    })
    .await;
    if !matches!(cleared, Ok(Ok(()))) {
        eprintln!("herdlingd serve: could not remove unregistered push tokens");
    }
}
