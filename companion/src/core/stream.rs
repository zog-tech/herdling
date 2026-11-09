//! The event lines of `herdr.subscribe` from herdr 1 and from the core in one stream. The
//! rules are in [`super::merge`]; this module does the I/O.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::client::Client;
use super::endpoint::CoreSocket;
use super::events::{refetch_hint, translate};
use super::merge::{Action, Leg, Merge, Side};
use crate::herdr::HerdrError;

/// Wait between two tries to connect a leg that is down.
pub const RETRY: Duration = Duration::from_secs(3);
/// Lines queued for the caller.
const QUEUE: usize = 1024;

/// What one stream reads from.
pub struct Sources {
    pub herdr_socket: PathBuf,
    pub timeout: Duration,
    /// The herdr 1 event types; `None` is the default set plus statuses.
    pub events: Option<Vec<String>>,
    /// The core, when this process knows its socket. Only a default subscription (`events`
    /// is `None`) reads the core.
    pub core: Option<CoreSocket>,
    pub retry: Duration,
}

enum Msg {
    Line(Value),
    Ended(Side),
}

async fn open_herdr(src: &Sources) -> Result<crate::events::EventStream, HerdrError> {
    crate::events::subscribe(&src.herdr_socket, src.timeout, src.events.clone()).await
}

async fn open_core(sock: &CoreSocket, timeout: Duration) -> Option<super::client::Subscription> {
    let c = Client::connect(&sock.current(), timeout).await.ok()?;
    c.subscribe(json!({})).await.ok().map(|(_, sub)| sub)
}

fn spawn_herdr(set: &mut JoinSet<()>, tx: mpsc::Sender<Msg>, mut stream: crate::events::EventStream) {
    set.spawn(async move {
        while let Some(ev) = stream.next().await {
            if tx.send(Msg::Line(ev)).await.is_err() {
                return;
            }
        }
        let _ = tx.send(Msg::Ended(Side::Herdr)).await;
    });
}

fn spawn_core(set: &mut JoinSet<()>, tx: mpsc::Sender<Msg>, mut sub: super::client::Subscription) {
    set.spawn(async move {
        while let Some(n) = sub.next().await {
            if let Some(line) = translate(&n) {
                if tx.send(Msg::Line(line)).await.is_err() {
                    return;
                }
            }
        }
        let _ = tx.send(Msg::Ended(Side::Core)).await;
    });
}

/// Opens the stream. Fails with the herdr 1 error when no leg connects. The receiver gets
/// herdr 1 event lines, core lines in herdr 1 shapes, refetch hints, and `{"closed": true}`
/// as the last line. Dropping the receiver ends the stream.
pub async fn open(src: Sources) -> Result<mpsc::Receiver<Value>, HerdrError> {
    let use_core = src.core.is_some() && src.events.is_none();
    let herdr = open_herdr(&src).await;
    let core = match (&src.core, use_core) {
        (Some(sock), true) => open_core(sock, src.timeout).await,
        _ => None,
    };
    let herdr_leg = if herdr.is_ok() { Leg::Up } else { Leg::Down };
    let core_leg = match (use_core, core.is_some()) {
        (false, _) => Leg::Off,
        (true, true) => Leg::Up,
        (true, false) => Leg::Down,
    };
    let Some(mut merge) = Merge::start(herdr_leg, core_leg) else {
        return Err(herdr.err().unwrap_or_else(|| HerdrError::Unavailable("no backend".into())));
    };
    let (out, rx) = mpsc::channel::<Value>(QUEUE);
    let (tx, mut legs) = mpsc::channel::<Msg>(QUEUE);
    let mut readers = JoinSet::new();
    if let Ok(stream) = herdr {
        spawn_herdr(&mut readers, tx.clone(), stream);
    }
    if let Some(sub) = core {
        spawn_core(&mut readers, tx.clone(), sub);
    }
    tokio::spawn(async move {
        let mut retry = tokio::time::interval_at(tokio::time::Instant::now() + src.retry, src.retry);
        retry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            let action = tokio::select! {
                _ = out.closed() => return,
                m = legs.recv() => match m {
                    Some(Msg::Line(v)) => {
                        if out.send(v).await.is_err() {
                            return;
                        }
                        Action::None
                    }
                    Some(Msg::Ended(side)) => merge.ended(side),
                    // The driver holds a sender, so the channel never closes.
                    None => Action::Close,
                },
                _ = retry.tick(), if !merge.to_retry().is_empty() => {
                    let mut action = Action::None;
                    for side in merge.to_retry() {
                        let up = match side {
                            Side::Herdr => match open_herdr(&src).await {
                                Ok(s) => {
                                    spawn_herdr(&mut readers, tx.clone(), s);
                                    true
                                }
                                Err(_) => false,
                            },
                            Side::Core => match src.core.as_ref() {
                                Some(sock) => match open_core(sock, src.timeout).await {
                                    Some(sub) => {
                                        spawn_core(&mut readers, tx.clone(), sub);
                                        true
                                    }
                                    None => false,
                                },
                                None => false,
                            },
                        };
                        if up && merge.connected(side) == Action::Hint {
                            action = Action::Hint;
                        }
                    }
                    action
                }
            };
            match action {
                Action::None => {}
                Action::Hint => {
                    if out.send(refetch_hint()).await.is_err() {
                        return;
                    }
                }
                Action::Close => {
                    let _ = out.send(json!({ "closed": true })).await;
                    return;
                }
            }
        }
    });
    Ok(rx)
}
