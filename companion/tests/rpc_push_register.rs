use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::{config, rpc};

async fn call(config_path: &std::path::Path, params: Value) -> Value {
    let (mut client_tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = rpc::Ctx::new(config_path.with_file_name("none.sock"), config_path.parent().unwrap().into());
    ctx.config_path = config_path.into();
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let req = json!({"id": 1, "method": "push.register", "params": params});
    client_tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(client_rx).lines();
    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap()
}

fn params(token: Value, needs_you: bool) -> Value {
    json!({"device_id":"d1","host_id":"h_1","name":"Sam-iPhone","expo_token":token,
           "prefs":{"finished":true,"needs_you":needs_you}})
}

#[tokio::test]
async fn register_then_update_prefs() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    let r = call(&p, params(json!("ExponentPushToken[test]"), false)).await;
    assert_eq!(r["result"], json!({"ok": true}));
    let c = config::load(&p).unwrap();
    assert_eq!(c.devices.len(), 1);
    assert!(!c.devices[0].prefs.needs_you);
    assert_eq!(c.devices[0].expo_token.as_deref(), Some("ExponentPushToken[test]"));

    // An existing public key survives a re-register.
    config::update(&p, |c| c.devices[0].public_key = Some("ssh-ed25519 AAAA".into())).unwrap();
    let r = call(&p, params(Value::Null, true)).await;
    assert_eq!(r["result"], json!({"ok": true}));
    let c = config::load(&p).unwrap();
    assert_eq!(c.devices.len(), 1);
    assert_eq!(c.devices[0].expo_token, None);
    assert!(c.devices[0].prefs.needs_you);
    assert_eq!(c.devices[0].public_key.as_deref(), Some("ssh-ed25519 AAAA"));
}

#[tokio::test]
async fn presentation_prefs_default_true_and_are_kept_when_missing() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    // A new device from an older app gets true for each.
    call(&p, params(Value::Null, true)).await;
    let prefs = config::load(&p).unwrap().devices[0].prefs.clone();
    assert!(prefs.replace && prefs.group && prefs.quiet_finished);
    let mut off = params(Value::Null, true);
    off["prefs"]["replace"] = json!(false);
    off["prefs"]["group"] = json!(false);
    off["prefs"]["quiet_finished"] = json!(false);
    call(&p, off).await;
    let prefs = config::load(&p).unwrap().devices[0].prefs.clone();
    assert!(!prefs.replace && !prefs.group && !prefs.quiet_finished);
    // An older app does not send the keys: the saved values stay.
    call(&p, params(Value::Null, true)).await;
    let prefs = config::load(&p).unwrap().devices[0].prefs.clone();
    assert!(!prefs.replace && !prefs.group && !prefs.quiet_finished);
}

#[tokio::test]
async fn quiet_at_desk_is_saved_and_kept_when_missing() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    // A new device from an older app gets the default.
    call(&p, params(Value::Null, true)).await;
    assert!(config::load(&p).unwrap().devices[0].prefs.quiet_at_desk);
    let mut off = params(Value::Null, true);
    off["prefs"]["quiet_at_desk"] = json!(false);
    call(&p, off).await;
    assert!(!config::load(&p).unwrap().devices[0].prefs.quiet_at_desk);
    // An older app does not send the key: the saved value stays.
    call(&p, params(Value::Null, true)).await;
    assert!(!config::load(&p).unwrap().devices[0].prefs.quiet_at_desk);
}

#[tokio::test]
async fn push_register_requires_device_id() {
    let dir = tempfile::tempdir().unwrap();
    let r = call(
        &dir.path().join("config.toml"),
        json!({"host_id":"h_1","name":"x","expo_token":null,"prefs":{"finished":true,"needs_you":true}}),
    )
    .await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn capabilities_are_saved_and_cleared_by_an_older_app() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    let mut with = params(json!("ExponentPushToken[test]"), true);
    with["capabilities"] = json!(["choice_actions"]);
    assert_eq!(call(&p, with).await["result"], json!({"ok": true}));
    let d = &config::load(&p).unwrap().devices[0];
    assert_eq!(d.capabilities, ["choice_actions"]);
    assert!(d.can(config::CHOICE_ACTIONS));
    // An app without the field (an older app, or a rollback) has no capabilities.
    call(&p, params(json!("ExponentPushToken[test]"), true)).await;
    assert!(config::load(&p).unwrap().devices[0].capabilities.is_empty());
}

#[tokio::test]
async fn capabilities_must_be_a_short_list_of_strings() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    let many: Vec<String> = (0..17).map(|i| format!("c{i}")).collect();
    for bad in [json!("choice_actions"), json!([1]), json!([""]), json!(["x".repeat(65)]), json!(many)] {
        let mut ps = params(Value::Null, true);
        ps["capabilities"] = bad.clone();
        assert_eq!(call(&p, ps).await["error"]["code"], "bad_request", "{bad}");
    }
}
