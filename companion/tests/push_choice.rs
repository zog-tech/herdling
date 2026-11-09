//! Push messages with and without the Yes and No buttons (`categoryId`, `data.choice`).

use herdlingd::choices::{PushChoice, PushOption};
use herdlingd::config::{Config, Device, Prefs};
use herdlingd::push::{messages, shell_messages};
use herdlingd::serve::debounce::Notice;
use serde_json::json;

fn device(id: &str, capabilities: &[&str]) -> Device {
    Device {
        id: id.into(),
        name: "Sam's phone".into(),
        host_id: "h_1".into(),
        public_key: None,
        expo_token: Some(format!("ExponentPushToken[{id}]")),
        capabilities: capabilities.iter().map(|c| c.to_string()).collect(),
        prefs: Prefs::default(),
    }
}

fn choice() -> PushChoice {
    PushChoice {
        yes: PushOption { key: "1".into(), label: "Yes".into() },
        no: PushOption { key: "2".into(), label: "No".into() },
        revision: 0,
        question: None,
    }
}

fn cfg() -> Config {
    let mut c = herdlingd::config::load(std::path::Path::new("/nonexistent/config.toml")).unwrap();
    c.devices = vec![device("new", &["choice_actions"]), device("old", &[])];
    c
}

#[test]
fn only_a_capable_device_gets_the_buttons() {
    let c = choice();
    let msgs = messages(&cfg(), Notice::NeedsYou, "w1:p1", "api", "claude", false, Some(&c));
    let v = serde_json::to_value(&msgs).unwrap();
    assert_eq!(
        v[0],
        json!({"to": "ExponentPushToken[new]", "title": "api needs you", "body": "claude\nYes · No", "sound": "default",
               "categoryId": "herdling_choice", "interruptionLevel": "time-sensitive",
               "collapseId": "herdling:h_1:w1:p1", "tag": "herdling:h_1:w1:p1", "threadId": "herdling:h_1",
               "data": {"hostId": "h_1", "paneId": "w1:p1",
                        "choice": {"yes": {"key": "1", "label": "Yes"}, "no": {"key": "2", "label": "No"}, "revision": 0}}})
    );
    assert_eq!(
        v[1],
        json!({"to": "ExponentPushToken[old]", "title": "api needs you", "body": "claude", "sound": "default", "interruptionLevel": "time-sensitive",
               "collapseId": "herdling:h_1:w1:p1", "tag": "herdling:h_1:w1:p1", "threadId": "herdling:h_1",
               "data": {"hostId": "h_1", "paneId": "w1:p1"}})
    );
}

#[test]
fn an_empty_body_shows_only_the_labels() {
    let c = choice();
    let msgs = messages(&cfg(), Notice::NeedsYou, "w1:p1", "api", "", false, Some(&c));
    assert_eq!(msgs[0].body, "Yes · No");
    assert_eq!(msgs[1].body, "");
}

#[test]
fn a_finished_push_never_has_buttons() {
    let c = choice();
    let msgs = messages(&cfg(), Notice::Finished, "w1:p1", "api", "claude", false, Some(&c));
    assert!(msgs.iter().all(|m| m.category_id.is_none() && m.data.choice.is_none() && m.body == "claude"));
}

#[test]
fn no_choice_gives_the_old_message() {
    let msgs = messages(&cfg(), Notice::NeedsYou, "w1:p1", "api", "claude", false, None);
    let v = serde_json::to_value(&msgs).unwrap();
    assert!(v[0].get("categoryId").is_none());
    assert!(v[0]["data"].get("choice").is_none());
}

#[test]
fn a_shell_push_goes_to_the_asking_device_with_kind_shell() {
    let msgs = shell_messages(&cfg(), Some("old"), "w1:p2", "proj: command finished", "cargo build", false);
    let v = serde_json::to_value(&msgs).unwrap();
    assert_eq!(
        v,
        json!([{"to": "ExponentPushToken[old]", "title": "proj: command finished", "body": "cargo build", "sound": "default",
                "collapseId": "herdling:h_1:w1:p2", "tag": "herdling:h_1:w1:p2", "threadId": "herdling:h_1",
                "data": {"hostId": "h_1", "paneId": "w1:p2", "kind": "shell"}}])
    );
    // No device id: every device. The `finished` pref does not apply: the user asked for this push.
    let mut c = cfg();
    c.devices[0].prefs.finished = false;
    assert_eq!(shell_messages(&c, None, "w1:p2", "t", "b", false).len(), 2);
    // An unknown device gets nothing.
    assert!(shell_messages(&c, Some("gone"), "w1:p2", "t", "b", false).is_empty());
}

#[test]
fn a_shell_push_respects_quiet_at_desk() {
    let mut c = cfg();
    c.devices[1].prefs.quiet_at_desk = false;
    let msgs = shell_messages(&c, None, "w1:p2", "t", "b", true);
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].to, "ExponentPushToken[old]");
}
