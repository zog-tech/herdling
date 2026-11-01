//! How a push shows on the phone: one notification per pane (`collapseId`, `tag`), one group per
//! computer (`threadId`) and the alert level (`interruptionLevel`, `sound`), each from a device pref.

use herdlingd::config::{Config, Device, Prefs};
use herdlingd::push::{messages, stable_id, PushMessage, MAX_COLLAPSE_ID};
use herdlingd::serve::debounce::Notice;

fn cfg(host_id: &str, prefs: Prefs) -> Config {
    let mut c = herdlingd::config::load(std::path::Path::new("/nonexistent/config.toml")).unwrap();
    c.devices = vec![Device {
        id: "d1".into(),
        name: "Sam's phone".into(),
        host_id: host_id.into(),
        public_key: None,
        expo_token: Some("ExponentPushToken[d1]".into()),
        capabilities: vec![],
        prefs,
    }];
    c
}

fn one(prefs: Prefs, notice: Notice) -> PushMessage {
    let mut msgs = messages(&cfg("h_1", prefs), notice, "w1:p2", "api", "claude", false, None);
    assert_eq!(msgs.len(), 1);
    msgs.remove(0)
}

#[test]
fn replace_on_gives_the_same_collapse_id_and_tag_per_pane() {
    let m = one(Prefs::default(), Notice::NeedsYou);
    assert_eq!(m.collapse_id.as_deref(), Some("herdling:h_1:w1:p2"));
    assert_eq!(m.tag, m.collapse_id);
    // A "finished" push of the same pane replaces the "needs you" push.
    assert_eq!(one(Prefs::default(), Notice::Finished).collapse_id, m.collapse_id);
}

#[test]
fn replace_off_gives_no_collapse_id_and_no_tag() {
    let m = one(Prefs { replace: false, ..Prefs::default() }, Notice::NeedsYou);
    assert_eq!(m.collapse_id, None);
    assert_eq!(m.tag, None);
    let v = serde_json::to_value(&m).unwrap();
    assert!(v.get("collapseId").is_none() && v.get("tag").is_none());
}

#[test]
fn group_on_gives_a_thread_per_computer() {
    let m = one(Prefs::default(), Notice::Finished);
    assert_eq!(m.thread_id.as_deref(), Some("herdling:h_1"));
    let other = messages(&cfg("h_2", Prefs::default()), Notice::Finished, "w1:p2", "api", "", false, None);
    assert_eq!(other[0].thread_id.as_deref(), Some("herdling:h_2"));
    // The same pane id on another computer is another notification.
    assert_eq!(other[0].collapse_id.as_deref(), Some("herdling:h_2:w1:p2"));
}

#[test]
fn group_off_gives_no_thread() {
    let m = one(Prefs { group: false, ..Prefs::default() }, Notice::Finished);
    assert_eq!(m.thread_id, None);
    assert!(serde_json::to_value(&m).unwrap().get("threadId").is_none());
}

#[test]
fn needs_you_is_time_sensitive_with_a_sound() {
    for prefs in [Prefs::default(), Prefs { quiet_finished: false, ..Prefs::default() }] {
        let m = one(prefs, Notice::NeedsYou);
        assert_eq!(m.interruption_level, Some("time-sensitive"));
        assert_eq!(m.sound, Some("default"));
    }
}

#[test]
fn quiet_finished_on_is_passive_without_a_sound() {
    let m = one(Prefs::default(), Notice::Finished);
    assert_eq!(m.interruption_level, Some("passive"));
    assert_eq!(m.sound, None);
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["interruptionLevel"], "passive");
    assert!(v.get("sound").is_none());
}

#[test]
fn quiet_finished_off_is_the_old_finished_push() {
    let m = one(Prefs { quiet_finished: false, ..Prefs::default() }, Notice::Finished);
    assert_eq!(m.interruption_level, None);
    assert_eq!(m.sound, Some("default"));
}

#[test]
fn collapse_id_is_at_most_64_bytes() {
    assert_eq!(stable_id(&["h_1", "w1:p2"]), "herdling:h_1:w1:p2");
    let host = "h_".to_string() + &"x".repeat(80);
    let id = stable_id(&[&host, "w1:p2"]);
    assert!(id.len() <= MAX_COLLAPSE_ID, "{id}");
    assert!(id.starts_with("herdling:"));
    // Stable, and different for another pane.
    assert_eq!(id, stable_id(&[&host, "w1:p2"]));
    assert_ne!(id, stable_id(&[&host, "w1:p3"]));
    // Exactly 64 bytes stays as it is; 65 bytes gets the hash.
    let fits = "a".repeat(MAX_COLLAPSE_ID - "herdling:".len());
    assert_eq!(stable_id(&[&fits]), format!("herdling:{fits}"));
    assert_eq!(stable_id(&[&fits]).len(), MAX_COLLAPSE_ID);
    let long = "a".repeat(MAX_COLLAPSE_ID - "herdling:".len() + 1);
    assert_eq!(stable_id(&[&long]).len(), "herdling:".len() + 32);
    let m = messages(&cfg(&host, Prefs::default()), Notice::NeedsYou, "w1:p2", "api", "", false, None);
    assert!(m[0].collapse_id.as_ref().unwrap().len() <= MAX_COLLAPSE_ID);
}
