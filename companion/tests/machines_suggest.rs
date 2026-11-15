//! `machines.suggest`: the pure rules of `suggest.rs`. No test reads the real `~/.ssh/config` or
//! runs the real `tailscale`.

use herdlingd::suggest::{self, Suggestion};
use serde_json::json;

const CONFIG: &str = r#"
# Global options
Host *
    ServerAliveInterval 30
    IdentityFile ~/.ssh/id_secret_global

Host studio studio-alias
    HostName studio.local
    User sam
    Port 2222
    IdentityFile ~/.ssh/id_secret_studio

host=lab
  hostname = 192.0.2.10
  USER=demo

Host "quoted"
    HostName quoted.example

Host web-?? !blocked
    HostName 192.0.2.99

Match host something
    HostName 192.0.2.50
    User root

Host box
    ProxyJump studio
    HostName 192.0.2.20

Host plain
"#;

fn names(list: &[Suggestion]) -> Vec<&str> {
    list.iter().map(|s| s.name.as_str()).collect()
}

#[test]
fn ssh_config_keeps_only_real_aliases() {
    let list = suggest::from_ssh_config(CONFIG);
    assert_eq!(names(&list), ["studio", "studio-alias", "lab", "quoted", "plain"]);
    let studio = &list[0];
    assert_eq!(studio.address, "studio.local");
    assert_eq!(studio.user.as_deref(), Some("sam"));
    assert_eq!(studio.port, Some(2222));
    assert_eq!(studio.sources, ["ssh_config"]);
    assert_eq!(list[2].address, "192.0.2.10");
    assert_eq!(list[2].user.as_deref(), Some("demo"));
    assert_eq!(list[3].address, "quoted.example");
    // An entry with no HostName uses its alias.
    assert_eq!(list[4].address, "plain");
    // No other value of the file leaves herdlingd.
    let text = serde_json::to_string(&list).unwrap();
    assert!(!text.contains("id_secret"));
    assert!(!text.contains("root"));
    assert!(!text.contains("ServerAlive"));
}

#[test]
fn ssh_config_skips_proxy_entries() {
    let list = suggest::from_ssh_config("Host box\n  ProxyCommand nc %h %p\nHost ok\n  ProxyJump none\n");
    assert_eq!(names(&list), ["ok"]);
}

#[test]
fn ssh_config_refuses_odd_values() {
    let list = suggest::from_ssh_config("Host x\n  HostName $(rm -rf /)\n  User a;b\nHost y\n  User sam\n");
    assert_eq!(names(&list), ["y"]);
    assert_eq!(list[0].user.as_deref(), Some("sam"));
}

#[test]
fn tailscale_peers_use_magic_dns() {
    let status = json!({
        "Self": {"HostName": "me", "DNSName": "me.example.ts.net."},
        "Peer": {
            "nodekey:b": {"HostName": "studio", "DNSName": "studio.example.ts.net.", "TailscaleIPs": ["100.64.0.2", "fd7a::2"], "Online": true},
            "nodekey:a": {"HostName": "Lab", "DNSName": "lab.example.ts.net.", "TailscaleIPs": ["100.64.0.3"], "Online": false, "PublicKey": "secret"}
        }
    });
    let list = suggest::from_tailscale(&status);
    assert_eq!(names(&list), ["Lab", "studio"]);
    assert_eq!(list[1].address, "studio.example.ts.net");
    assert_eq!(list[1].online, Some(true));
    assert_eq!(list[0].online, Some(false));
    assert!(!serde_json::to_string(&list).unwrap().contains("secret"));
}

#[test]
fn tailscale_without_dns_uses_ipv4() {
    let status = json!({"Peer": {"k": {"HostName": "box", "DNSName": "", "TailscaleIPs": ["fd7a::5", "100.64.0.5"]}}});
    let list = suggest::from_tailscale(&status);
    assert_eq!(list[0].address, "100.64.0.5");
    assert!(suggest::from_tailscale(&json!({})).is_empty());
}

#[test]
fn core_machines_parse_targets() {
    let r = json!({"machines": [
        {"name": "studio", "target": "sam@studio.local:2222", "id": "c2", "host": "studio", "version": "0.1.19", "state": "connected"},
        {"name": "lab", "target": "lab.example", "id": "c3", "host": "lab", "version": "0.1.19", "state": "unreachable"},
        {"name": "pod", "target": "kubectl exec -it pod --", "via": true, "id": "c4", "host": "pod-7", "version": "0.1.19", "state": "connecting"}
    ]});
    let list = suggest::from_core(&r);
    assert_eq!(names(&list), ["studio", "lab", "pod"]);
    assert_eq!((list[0].user.as_deref(), list[0].address.as_str(), list[0].port), (Some("sam"), "studio.local", Some(2222)));
    assert_eq!(list[0].online, Some(true));
    assert_eq!(list[1].online, Some(false));
    // A command is not an address: the host name stands in.
    assert_eq!(list[2].address, "pod-7");
    assert_eq!(suggest::parse_target("[2001:db8::1]:22"), (None, "2001:db8::1".to_string(), Some(22)));
    assert_eq!(suggest::parse_target("2001:db8::1"), (None, "2001:db8::1".to_string(), None));
}

#[test]
fn merge_joins_sources_and_drops_self() {
    let ssh = suggest::from_ssh_config("Host studio\n  HostName Studio.Local\n  User sam\nHost me\n  HostName me.local\nHost lo\n  HostName localhost\n");
    let core = suggest::from_core(&json!({"machines": [{"name": "studio-core", "target": "studio.local", "id": "x", "host": "studio", "version": "1", "state": "connected"}]}));
    let ts = suggest::from_tailscale(&json!({"Peer": {"k": {"HostName": "me", "DNSName": "me.example.ts.net."}}}));
    let list = suggest::merge(vec![core, ssh, ts], &["me.local".to_string()]);
    assert_eq!(names(&list), ["studio-core"]);
    assert_eq!(list[0].sources, ["core", "ssh_config"]);
    assert_eq!(list[0].user.as_deref(), Some("sam"));
    assert_eq!(list[0].online, Some(true));
}

// --- The method in a `herdlingd rpc` session. ---

#[path = "support/fake_core.rs"]
mod fake_core;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use herdlingd::core::endpoint::CoreSocket;
use herdlingd::rpc::{self, Ctx};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn call(ctx: Ctx) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(1 << 20);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut rx = BufReader::new(client_rx).lines();
    tx.write_all(format!("{}\n", json!({"id": 1, "method": "machines.suggest"})).as_bytes()).await.unwrap();
    let line = tokio::time::timeout(Duration::from_secs(10), rx.next_line()).await.unwrap().unwrap().unwrap();
    serde_json::from_str(&line).unwrap()
}

fn suggestion_names(r: &Value) -> Vec<String> {
    r["result"]["suggestions"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn suggest_reads_the_given_config_and_tailscale() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::create_dir_all(home.join(".ssh")).unwrap();
    std::fs::write(home.join(".ssh/config"), "Host studio\n  HostName studio.local\n  User sam\n  IdentityFile ~/.ssh/id_x\n").unwrap();
    let bin = home.join("tailscale");
    let out = json!({"Peer": {"k": {"HostName": "lab", "DNSName": "lab.example.ts.net.", "Online": true}}});
    std::fs::write(&bin, format!("#!/bin/sh\n[ \"$1 $2\" = \"status --json\" ] || exit 2\ncat <<'X'\n{out}\nX\n")).unwrap();
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut ctx = Ctx::new(home.to_path_buf());
    ctx.tailscale = Some(bin);
    let r = call(ctx).await;
    assert_eq!(suggestion_names(&r), ["studio", "lab"]);
    assert_eq!(r["result"]["suggestions"][0]["sources"], json!(["ssh_config"]));
    assert_eq!(r["result"]["suggestions"][1]["sources"], json!(["tailscale"]));
    assert!(!r.to_string().contains("id_x"));
}

#[tokio::test]
async fn suggest_without_sources_is_empty() {
    let dir = tempfile::tempdir().unwrap();
    let mut ctx = Ctx::new(dir.path().to_path_buf());
    // A tailscale that fails gives no peers and no error.
    ctx.tailscale = Some(dir.path().join("missing-tailscale"));
    let r = call(ctx).await;
    assert_eq!(r["result"]["suggestions"], json!([]));
}

#[tokio::test]
async fn suggest_adds_core_machines() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("core.sock");
    let _core = fake_core::spawn(
        &sock,
        fake_core::State {
            machines: vec![json!({"name": "box", "target": "sam@box.example", "id": "c9", "host": "box", "version": "0.1.19", "state": "connected"})],
            ..Default::default()
        },
    );
    let mut ctx = Ctx::new(dir.path().to_path_buf());
    ctx.core_socket = Some(CoreSocket::fixed(&sock));
    let r = call(ctx).await;
    assert_eq!(suggestion_names(&r), ["box"]);
    assert_eq!(r["result"]["suggestions"][0]["user"], "sam");
    assert_eq!(r["result"]["suggestions"][0]["online"], true);
}
