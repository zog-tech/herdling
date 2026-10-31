//! Browser preview: the proxy request parse, the grant file, the proxy refusals and the byte copy.

use std::time::Duration;

use herdlingd::proxy::{self, ProxyCtx, Refusal, GRANT_TTL, MAX_GRANTS};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const G: &str = "0123456789abcdef0123456789abcdef";

#[test]
fn parse_accepts_the_proxy_request() {
    assert_eq!(proxy::parse_original_command(&format!("herdlingd proxy 5173 {G}")), Some((5173, G.to_string())));
    assert_eq!(
        proxy::parse_original_command(&format!("/home/sam/.local/bin/herdlingd proxy 1 {G}")),
        Some((1, G.to_string()))
    );
    assert_eq!(proxy::parse_original_command(&format!("~/.local/bin/herdlingd proxy 65535 {G}")), Some((65535, G.to_string())));
    // Extra white space between the words is accepted; the words must still match exactly.
    assert_eq!(proxy::parse_original_command(&format!("  herdlingd   proxy\t3000  {G} ")), Some((3000, G.to_string())));
}

#[test]
fn parse_rejects_other_text() {
    for bad in [
        String::new(),
        "herdlingd rpc".into(),
        format!("herdlingd proxy 0 {G}"),
        format!("herdlingd proxy 65536 {G}"),
        format!("herdlingd proxy 05173 {G}"),
        format!("herdlingd proxy +80 {G}"),
        format!("herdlingd proxy -1 {G}"),
        format!("herdlingd proxy 10.0.0.1:80 {G}"),
        format!("herdlingd proxy localhost:80 {G}"),
        "herdlingd proxy 5173 0123".into(),
        format!("herdlingd proxy 5173 {}", G.to_uppercase()),
        format!("herdlingd proxy 5173 {G}0"),
        format!("herdlingd proxy 5173 {G} extra"),
        format!("herdlingd proxy 5173 {G};rm -rf ~"),
        format!("herdlingd proxy 5173 $(id){}", &G[5..]),
        format!("herdlingd proxy $(id) {G}"),
        format!("herdlingd proxy 5173;id {G}"),
        format!("notherdlingd proxy 5173 {G}"),
        format!("sh -c herdlingd proxy 5173 {G}x"),
        format!("herdlingd Proxy 5173 {G}"),
        format!("proxy 5173 {G}"),
    ] {
        assert_eq!(proxy::parse_original_command(&bad), None, "{bad:?}");
    }
}

#[test]
fn grants_are_random_hex() {
    let (a, b) = (proxy::new_grant(), proxy::new_grant());
    assert!(proxy::valid_grant(&a) && proxy::valid_grant(&b));
    assert_ne!(a, b);
}

#[test]
fn targets_are_loopback_only() {
    for a in proxy::targets(5173) {
        assert!(a.ip().is_loopback(), "{a}");
        assert_eq!(a.port(), 5173);
    }
}

#[test]
fn grant_file_is_private_and_checks_port_and_expiry() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = proxy::grants_path(dir.path());
    let now = 1_000_000;
    let g = proxy::issue(&path, 5173, now).unwrap();
    assert_eq!(g.expires, now + GRANT_TTL.as_secs());
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);

    assert_eq!(proxy::check(&path, 5173, &g.grant, 7790, now + 10), Ok(()));
    assert_eq!(proxy::check(&path, 3000, &g.grant, 7790, now + 10), Err(Refusal::WrongPort));
    assert_eq!(proxy::check(&path, 5173, G, 7790, now + 10), Err(Refusal::NoGrant));
    assert_eq!(proxy::check(&path, 5173, "zz", 7790, now + 10), Err(Refusal::BadGrant));
    assert_eq!(proxy::check(&path, 0, &g.grant, 7790, now + 10), Err(Refusal::BadPort));
    // The pairing port is never proxied, even with a grant.
    assert_eq!(proxy::check(&path, 7790, &g.grant, 7790, now + 10), Err(Refusal::Reserved));

    // Each connection extends the grant's life.
    let later = now + GRANT_TTL.as_secs() - 1;
    assert_eq!(proxy::check(&path, 5173, &g.grant, 7790, later), Ok(()));
    assert_eq!(proxy::check(&path, 5173, &g.grant, 7790, later + GRANT_TTL.as_secs() - 1), Ok(()));
    // An unused grant expires.
    let gone = later + 3 * GRANT_TTL.as_secs();
    assert_eq!(proxy::check(&path, 5173, &g.grant, 7790, gone), Err(Refusal::NoGrant));
    assert!(!std::fs::read_to_string(&path).unwrap().contains(&g.grant), "expired grants are dropped on write");
}

#[test]
fn revoke_removes_the_grant() {
    let dir = tempfile::tempdir().unwrap();
    let path = proxy::grants_path(dir.path());
    let a = proxy::issue(&path, 5173, 100).unwrap();
    let b = proxy::issue(&path, 3000, 100).unwrap();
    assert!(proxy::revoke(&path, &a.grant, 101).unwrap());
    assert!(!proxy::revoke(&path, &a.grant, 101).unwrap());
    assert_eq!(proxy::check(&path, 5173, &a.grant, 7790, 102), Err(Refusal::NoGrant));
    assert_eq!(proxy::check(&path, 3000, &b.grant, 7790, 102), Ok(()));
}

#[test]
fn grant_count_is_capped() {
    let dir = tempfile::tempdir().unwrap();
    let path = proxy::grants_path(dir.path());
    let grants: Vec<_> = (0..MAX_GRANTS + 3).map(|i| proxy::issue(&path, 5000, 100 + i as u64).unwrap()).collect();
    let now = 100 + grants.len() as u64;
    assert_eq!(proxy::check(&path, 5000, &grants[0].grant, 7790, now), Err(Refusal::NoGrant), "the oldest grant goes");
    assert_eq!(proxy::check(&path, 5000, &grants.last().unwrap().grant, 7790, now), Ok(()));
}

#[test]
fn a_broken_grant_file_refuses_and_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let path = proxy::grants_path(dir.path());
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "not json").unwrap();
    assert_eq!(proxy::check(&path, 5173, G, 7790, 1), Err(Refusal::NoGrant));
    let g = proxy::issue(&path, 5173, 1).unwrap();
    assert_eq!(proxy::check(&path, 5173, &g.grant, 7790, 2), Ok(()));
}

/// An echo server on 127.0.0.1. Returns its port.
async fn echo_server() -> u16 {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut s, _)) = l.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = s.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    port
}

fn ctx(dir: &std::path::Path) -> ProxyCtx {
    ProxyCtx { connect_timeout: Duration::from_secs(2), ..ProxyCtx::new(dir, 7790) }
}

#[tokio::test]
async fn proxy_copies_bytes_both_ways() {
    let dir = tempfile::tempdir().unwrap();
    let c = ctx(dir.path());
    let port = echo_server().await;
    let g = proxy::issue(&c.grants_path, port, proxy::now_secs()).unwrap();

    let (mut phone, chan_in) = tokio::io::duplex(1 << 16);
    let (chan_out, mut phone_rx) = tokio::io::duplex(1 << 16);
    let run = tokio::spawn(async move { proxy::run(chan_in, chan_out, port, &g.grant, &c).await });

    // Binary bytes, not only text.
    let payload: Vec<u8> = (0..=255u8).cycle().take(40_000).collect();
    phone.write_all(&payload).await.unwrap();
    let mut got = vec![0u8; payload.len()];
    tokio::time::timeout(Duration::from_secs(5), phone_rx.read_exact(&mut got)).await.unwrap().unwrap();
    assert_eq!(got, payload);

    // The channel closes: the proxy ends.
    drop(phone);
    let r = tokio::time::timeout(Duration::from_secs(10), run).await.unwrap().unwrap();
    assert_eq!(r, Ok(()));
}

#[tokio::test]
async fn proxy_ends_when_the_server_closes() {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut s, _) = l.accept().await.unwrap();
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let c = ctx(dir.path());
    let g = proxy::issue(&c.grants_path, port, proxy::now_secs()).unwrap();
    let (_phone, chan_in) = tokio::io::duplex(1 << 16);
    let (chan_out, mut phone_rx) = tokio::io::duplex(1 << 16);
    let r = tokio::time::timeout(Duration::from_secs(10), proxy::run(chan_in, chan_out, port, &g.grant, &c)).await.unwrap();
    assert_eq!(r, Ok(()));
    let mut got = String::new();
    phone_rx.read_to_string(&mut got).await.unwrap();
    assert!(got.ends_with("\r\n\r\nok"), "{got:?}");
}

#[tokio::test]
async fn proxy_refuses_without_a_matching_grant() {
    let dir = tempfile::tempdir().unwrap();
    let c = ctx(dir.path());
    let port = echo_server().await;
    let other = proxy::issue(&c.grants_path, port + 1, proxy::now_secs()).unwrap();
    for (p, g, want) in [
        (port, G.to_string(), Refusal::NoGrant),
        (port, other.grant.clone(), Refusal::WrongPort),
        (port, "nothex".to_string(), Refusal::BadGrant),
        (7790, other.grant.clone(), Refusal::Reserved),
    ] {
        let (_a, chan_in) = tokio::io::duplex(64);
        let (chan_out, _b) = tokio::io::duplex(64);
        assert_eq!(proxy::run(chan_in, chan_out, p, &g, &c).await, Err(want));
    }
}

#[tokio::test]
async fn proxy_reports_a_port_with_no_listener() {
    // Bind and drop, so the port is very likely free.
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let dir = tempfile::tempdir().unwrap();
    let c = ctx(dir.path());
    let g = proxy::issue(&c.grants_path, port, proxy::now_secs()).unwrap();
    let (_a, chan_in) = tokio::io::duplex(64);
    let (chan_out, _b) = tokio::io::duplex(64);
    assert!(matches!(proxy::run(chan_in, chan_out, port, &g.grant, &c).await, Err(Refusal::Connect(_))));
}

#[tokio::test]
async fn proxy_reaches_a_server_on_ipv6_loopback_only() {
    // Some CI machines have no IPv6 loopback: then there is nothing to test.
    let Ok(l) = tokio::net::TcpListener::bind("[::1]:0").await else { return };
    let port = l.local_addr().unwrap().port();
    if std::net::TcpListener::bind(("127.0.0.1", port)).is_err() {
        return; // The IPv4 port is taken by something else: the test would not be about ::1.
    }
    tokio::spawn(async move {
        let (mut s, _) = l.accept().await.unwrap();
        s.write_all(b"v6").await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let c = ctx(dir.path());
    let g = proxy::issue(&c.grants_path, port, proxy::now_secs()).unwrap();
    let (_phone, chan_in) = tokio::io::duplex(64);
    let (chan_out, mut rx) = tokio::io::duplex(64);
    proxy::run(chan_in, chan_out, port, &g.grant, &c).await.unwrap();
    let mut got = String::new();
    rx.read_to_string(&mut got).await.unwrap();
    assert_eq!(got, "v6");
}
