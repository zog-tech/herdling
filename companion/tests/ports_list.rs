//! `ports.list`, `preview.open` and `preview.close`: the parsers with fixture output, the item
//! builder, and the methods against a real listener of the test process.

use std::net::IpAddr;
use std::path::Path;
use std::time::{Duration, SystemTime};

use herdlingd::ports::{self, Listener};
use herdlingd::proxy;
use herdlingd::rpc::{self, Ctx};
use herdlingd::transcript::procs::Proc;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const LSOF: &str = "\
p4411
cnode
f23
n127.0.0.1:5173
f24
n[::1]:5173
p3900
cnext-server
f20
n*:3000
p812
cpostgres
f7
n192.168.0.10:5432
f8
n127.0.0.1:5432->127.0.0.1:61000
p900
cherdlingd
f9
n*:7790
";

#[test]
fn lsof_output_parses() {
    let l = ports::parse_lsof(LSOF);
    let ip = |s: &str| s.parse::<IpAddr>().unwrap();
    assert_eq!(
        l,
        vec![
            Listener { port: 5173, addr: ip("127.0.0.1"), pid: Some(4411) },
            Listener { port: 5173, addr: ip("::1"), pid: Some(4411) },
            Listener { port: 3000, addr: ip("0.0.0.0"), pid: Some(3900) },
            Listener { port: 5432, addr: ip("192.168.0.10"), pid: Some(812) },
            Listener { port: 7790, addr: ip("0.0.0.0"), pid: Some(900) },
        ]
    );
}

const TCP: &str = "\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41001 1 0000000000000000 100 0 0 10 0
   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41002 1 0000000000000000 100 0 0 10 0
   2: 0A00000A:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41003 1 0000000000000000 100 0 0 10 0
   3: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 41004 1 0000000000000000 100 0 0 10 0
   4: 0100007F:1435 0100007F:EE48 01 00000000:00000000 00:00000000 00000000  1000        0 41005 1 0000000000000000 100 0 0 10 0
";

const TCP6: &str = "\
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 52001 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 52002 1 0000000000000000 100 0 0 10 0
   2: 0000000000000000FFFF00000100007F:22B8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 52003 1 0000000000000000 100 0 0 10 0
";

#[test]
fn proc_net_tcp_parses_listeners_of_the_user() {
    // The fixtures are in the little-endian form of x86 and ARM Linux.
    if cfg!(target_endian = "big") {
        return;
    }
    let ip = |s: &str| s.parse::<IpAddr>().unwrap();
    assert_eq!(
        ports::parse_proc_net_tcp(TCP, false, 1000),
        vec![(ip("127.0.0.1"), 5173, 41001), (ip("0.0.0.0"), 3000, 41002), (ip("10.0.0.10"), 5432, 41003)]
    );
    assert_eq!(
        ports::parse_proc_net_tcp(TCP6, true, 1000),
        vec![(ip("::1"), 5173, 52001), (ip("::"), 8080, 52002), (ip("::ffff:127.0.0.1"), 8888, 52003)]
    );
    assert!(ports::parse_proc_net_tcp(TCP, false, 0).iter().all(|s| s.2 == 41004));
    assert_eq!(ports::socket_inode("socket:[41001]"), Some(41001));
    assert_eq!(ports::socket_inode("pipe:[41001]"), None);
}

#[test]
fn only_loopback_and_wildcard_addresses_are_allowed() {
    for ok in ["127.0.0.1", "127.1.2.3", "0.0.0.0", "::1", "::", "::ffff:127.0.0.1"] {
        assert!(ports::allowed_addr(&ok.parse().unwrap()), "{ok}");
    }
    for bad in ["192.168.0.10", "10.0.0.1", "fe80::1", "::ffff:10.0.0.1", "2001:db8::1"] {
        assert!(!ports::allowed_addr(&bad.parse().unwrap()), "{bad}");
    }
}

fn p(pid: u32, ppid: u32, name: &str, cmd: &[&str]) -> Proc {
    Proc { pid, ppid, name: name.into(), cmd: cmd.iter().map(|s| s.to_string()).collect(), start: SystemTime::UNIX_EPOCH }
}

#[test]
fn cmd_label_names_the_program() {
    assert_eq!(ports::cmd_label(&p(1, 0, "node", &["node", "/home/sam/proj/node_modules/.bin/vite", "--port", "5173"])).as_deref(), Some("vite"));
    assert_eq!(ports::cmd_label(&p(1, 0, "next-server", &["next-server (v15)"])).as_deref(), Some("next-server"));
    assert_eq!(ports::cmd_label(&p(1, 0, "python3", &["python3", "-m", "http.server", "8080"])).as_deref(), Some("http.server"));
    assert_eq!(ports::cmd_label(&p(1, 0, "node", &["node", "server.js"])).as_deref(), Some("server"));
    assert_eq!(ports::cmd_label(&p(1, 0, "node", &["node"])).as_deref(), Some("node"));
}

#[test]
fn build_marks_pane_ports_first_and_drops_others() {
    let listeners = ports::parse_lsof(LSOF);
    let procs = vec![
        p(100, 1, "zsh", &["-zsh"]),
        p(200, 100, "pnpm", &["pnpm", "dev"]),
        p(4411, 200, "node", &["node", "/home/sam/proj/node_modules/.bin/vite"]),
        p(3900, 1, "next-server", &["next-server"]),
    ];
    let roots = [100];
    let items = ports::build(&listeners, &procs, Some(("w1:p2", &roots)), 7790);
    let v = serde_json::to_value(&items).unwrap();
    assert_eq!(
        v,
        json!([
            {"port": 5173, "addr": "127.0.0.1", "pid": 4411, "process": "node", "cmd": "vite", "pane_id": "w1:p2"},
            {"port": 3000, "addr": "0.0.0.0", "pid": 3900, "process": "next-server", "cmd": "next-server"}
        ])
    );
    // Without a pane, the order is by port.
    let plain = ports::build(&listeners, &procs, None, 7790);
    assert_eq!(plain.iter().map(|i| i.port).collect::<Vec<_>>(), vec![3000, 5173]);
    assert!(plain.iter().all(|i| i.pane_id.is_none()));
}

async fn call(home: &Path, method: &str, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 16);
    let (server_out, client_rx) = tokio::io::duplex(1 << 20);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(home.join("none.sock"), home.into())));
    let req = json!({"id": 1, "method": method, "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(client_rx).lines();
    let l = tokio::time::timeout(Duration::from_secs(30), lines.next_line()).await.unwrap().unwrap().unwrap();
    serde_json::from_str(&l).unwrap()
}

#[tokio::test]
async fn methods_find_a_listener_and_issue_a_grant() {
    let home = tempfile::tempdir().unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let list = call(home.path(), "ports.list", json!({})).await;
    let found = list["result"]["ports"].as_array().unwrap().iter().any(|i| i["port"] == port);
    assert!(found, "the test listener on port {port} is listed: {list}");

    let open = call(home.path(), "preview.open", json!({"port": port})).await;
    let grant = open["result"]["grant"].as_str().unwrap_or_else(|| panic!("{open}")).to_string();
    assert!(proxy::valid_grant(&grant));
    assert_eq!(open["result"]["port"], port);
    let path = proxy::grants_path(home.path());
    assert_eq!(proxy::check(&path, port, &grant, 7790, proxy::now_secs()), Ok(()));

    let close = call(home.path(), "preview.close", json!({"grant": grant})).await;
    assert_eq!(close["result"]["closed"], true);
    assert!(proxy::check(&path, port, &grant, 7790, proxy::now_secs()).is_err());
    drop(listener);
}

#[tokio::test]
async fn preview_open_refuses_bad_and_closed_ports() {
    let home = tempfile::tempdir().unwrap();
    let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let r = call(home.path(), "preview.open", json!({"port": free})).await;
    assert_eq!(r["error"]["code"], "port_not_listening", "{r}");
    for bad in [json!({}), json!({"port": 0}), json!({"port": 70000}), json!({"port": "5173"}), json!({"port": -1})] {
        let r = call(home.path(), "preview.open", bad.clone()).await;
        assert_eq!(r["error"]["code"], "bad_request", "{bad} {r}");
    }
    let r = call(home.path(), "preview.open", json!({"port": 7790})).await;
    assert_eq!(r["error"]["code"], "bad_request", "the pairing port is reserved: {r}");
    let r = call(home.path(), "preview.close", json!({"grant": "../../etc"})).await;
    assert_eq!(r["error"]["code"], "grant_invalid");
    let r = call(home.path(), "preview.close", json!({"grant": "0123456789abcdef0123456789abcdef"})).await;
    assert_eq!(r["result"]["closed"], false);
}
