use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::rpc::{self, Ctx};

async fn start(dir: &tempfile::TempDir) -> (tokio::io::DuplexStream, tokio::io::Lines<BufReader<tokio::io::DuplexStream>>) {
    let (client_tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let ctx = Ctx::new(dir.path().join("none.sock"), dir.path().into());
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    (client_tx, BufReader::new(client_rx).lines())
}

async fn get(
    tx: &mut tokio::io::DuplexStream,
    rx: &mut tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
    id: u32,
) -> Value {
    tx.write_all(format!("{{\"id\":{id},\"method\":\"stats.get\",\"params\":{{}}}}\n").as_bytes()).await.unwrap();
    serde_json::from_str(&rx.next_line().await.unwrap().unwrap()).unwrap()
}

#[tokio::test]
async fn stats_are_sane() {
    let dir = tempfile::tempdir().unwrap();
    let (mut tx, mut rx) = start(&dir).await;
    let r = get(&mut tx, &mut rx, 1).await;
    let s = &r["result"];
    let cpu = s["cpu_pct"].as_f64().unwrap();
    assert!((0.0..=100.0).contains(&cpu), "cpu {cpu}");
    let (used, total) = (s["mem_used"].as_u64().unwrap(), s["mem_total"].as_u64().unwrap());
    assert!(0 < used && used <= total, "mem {used}/{total}");
    assert!(s["uptime_s"].as_u64().unwrap() > 0);
    assert_eq!(s["load"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn second_call_is_fast() {
    let dir = tempfile::tempdir().unwrap();
    let (mut tx, mut rx) = start(&dir).await;
    get(&mut tx, &mut rx, 1).await;
    let t = Instant::now();
    let r = get(&mut tx, &mut rx, 2).await;
    assert!(r["result"].is_object());
    assert!(t.elapsed() < Duration::from_millis(100), "took {:?}", t.elapsed());
}
