//! The raw terminal stream batcher (`core::vt`): event shapes, sequence numbers, chunks.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use herdlingd::core::vt::{Batch, MAX_BATCH, MAX_EVENT};
use serde_json::{json, Value};

fn bytes_of(events: &[Value]) -> Vec<u8> {
    events
        .iter()
        .filter(|e| e["vt"] == "data")
        .flat_map(|e| STANDARD.decode(e["data"].as_str().unwrap()).unwrap())
        .collect()
}

#[test]
fn reset_starts_a_generation() {
    let mut b = Batch::default();
    assert_eq!(b.reset(3, 80, 24), vec![json!({"vt": "reset", "gen": 3, "seq": 0, "cols": 80, "rows": 24})]);
}

#[test]
fn feed_then_flush_gives_one_data_event() {
    let mut b = Batch::default();
    b.reset(1, 80, 24);
    assert!(b.feed(b"\x1b[31mred").is_empty());
    let out = b.flush();
    assert_eq!(out, vec![json!({"vt": "data", "gen": 1, "seq": 1, "data": STANDARD.encode(b"\x1b[31mred")})]);
    // Nothing waits: no event.
    assert!(b.flush().is_empty());
}

#[test]
fn big_flush_is_cut_into_events() {
    let mut b = Batch::default();
    b.reset(1, 80, 24);
    let input: Vec<u8> = (0..100 * 1024).map(|i| (i % 251) as u8).collect();
    b.feed(&input);
    let out = b.flush();
    assert_eq!(out.len(), 3);
    let seqs: Vec<u64> = out.iter().map(|e| e["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, vec![1, 2, 3]);
    assert!(out.iter().all(|e| STANDARD.decode(e["data"].as_str().unwrap()).unwrap().len() <= MAX_EVENT));
    assert_eq!(bytes_of(&out), input);
}

#[test]
fn resize_flushes_the_bytes_first() {
    let mut b = Batch::default();
    b.reset(2, 80, 24);
    b.feed(b"abc");
    let out = b.resize(45, 30);
    assert_eq!(out.len(), 2);
    assert_eq!(out[0]["vt"], "data");
    assert_eq!(out[1], json!({"vt": "resize", "gen": 2, "seq": 2, "cols": 45, "rows": 30}));
}

#[test]
fn reset_drops_the_old_batch() {
    let mut b = Batch::default();
    b.reset(1, 80, 24);
    b.feed(b"old bytes");
    let out = b.reset(2, 100, 40);
    assert_eq!(out, vec![json!({"vt": "reset", "gen": 2, "seq": 0, "cols": 100, "rows": 40})]);
    b.feed(b"new");
    let out = b.flush();
    assert_eq!(out[0]["seq"], 1);
    assert_eq!(out[0]["gen"], 2);
    assert_eq!(bytes_of(&out), b"new");
}

#[test]
fn a_full_batch_flushes_in_feed() {
    let mut b = Batch::default();
    b.reset(1, 80, 24);
    let out = b.feed(&vec![b'x'; MAX_BATCH]);
    assert!(!out.is_empty());
    assert_eq!(bytes_of(&out).len(), MAX_BATCH);
    assert!(b.flush().is_empty());
}

#[test]
fn bytes_before_a_reset_are_dropped() {
    let mut b = Batch::default();
    assert!(b.feed(b"early").is_empty());
    assert!(b.flush().is_empty());
}
