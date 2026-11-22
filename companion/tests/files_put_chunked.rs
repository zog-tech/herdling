//! `files.put_begin`, `files.put_chunk`, `files.put_end` and `files.put_abort`: an upload in parts.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use herdlingd::rpc::{self, Ctx};
use herdlingd::uploads;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Sends the calls on one rpc channel, one after the other, and returns the responses.
async fn calls(home: &Path, reqs: &[(&str, Value)]) -> Vec<Value> {
    let (mut tx, server_in) = tokio::io::duplex(1 << 20);
    let (server_out, client_rx) = tokio::io::duplex(1 << 20);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(home.into())));
    let mut lines = BufReader::new(client_rx).lines();
    let mut out = Vec::new();
    for (i, (method, params)) in reqs.iter().enumerate() {
        let req = json!({"id": i + 1, "method": method, "params": params});
        tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
        out.push(serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap());
    }
    out
}

async fn call(home: &Path, method: &str, params: Value) -> Value {
    calls(home, &[(method, params)]).await.remove(0)
}

async fn begin(home: &Path, name: &str, size: u64) -> String {
    let r = call(home, "files.put_begin", json!({"name": name, "size": size})).await;
    r["result"]["upload_id"].as_str().unwrap_or_else(|| panic!("{r}")).to_string()
}

#[tokio::test]
async fn uploads_a_file_in_parts() {
    let home = tempfile::tempdir().unwrap();
    let data: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
    let r = call(home.path(), "files.put_begin", json!({"name": "my clip.mov", "size": data.len()})).await;
    assert_eq!(r["result"]["chunk_bytes"], uploads::CHUNK_BYTES);
    assert_eq!(r["result"]["max_bytes"], uploads::MAX_CHUNKED_BYTES);
    let id = r["result"]["upload_id"].as_str().unwrap().to_string();
    assert!(uploads::valid_id(&id));

    let mut offset = 0;
    for part in data.chunks(3000) {
        let r = call(home.path(), "files.put_chunk", json!({"upload_id": id, "offset": offset, "data_b64": b64(part)})).await;
        offset += part.len();
        assert_eq!(r["result"]["received"], offset, "{r}");
    }
    let r = call(home.path(), "files.put_end", json!({"upload_id": id})).await;
    let path = PathBuf::from(r["result"]["path"].as_str().unwrap_or_else(|| panic!("{r}")));
    assert_eq!(path.parent().unwrap(), uploads::dir(home.path()));
    assert!(path.file_name().unwrap().to_str().unwrap().ends_with("-my_clip.mov"));
    assert_eq!(std::fs::read(&path).unwrap(), data);
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    let partial = uploads::partial_dir(home.path());
    assert_eq!(std::fs::metadata(&partial).unwrap().permissions().mode() & 0o777, 0o700);
    assert_eq!(std::fs::read_dir(&partial).unwrap().count(), 0, "the partial files are gone");

    // The id is used up.
    let r = call(home.path(), "files.put_end", json!({"upload_id": id})).await;
    assert_eq!(r["error"]["code"], "not_found");
}

#[tokio::test]
async fn refuses_parts_out_of_order() {
    let home = tempfile::tempdir().unwrap();
    let id = begin(home.path(), "a.mp4", 6).await;
    let r = calls(
        home.path(),
        &[
            ("files.put_chunk", json!({"upload_id": id, "offset": 3, "data_b64": b64(b"def")})),
            ("files.put_chunk", json!({"upload_id": id, "offset": 0, "data_b64": b64(b"abc")})),
            ("files.put_chunk", json!({"upload_id": id, "offset": 0, "data_b64": b64(b"abc")})),
            ("files.put_end", json!({"upload_id": id})),
            ("files.put_chunk", json!({"upload_id": id, "offset": 3, "data_b64": b64(b"defg")})),
            ("files.put_chunk", json!({"upload_id": id, "offset": 3, "data_b64": b64(b"def")})),
            ("files.put_end", json!({"upload_id": id})),
        ],
    )
    .await;
    assert_eq!(r[0]["error"]["code"], "bad_offset", "a gap");
    assert_eq!(r[1]["result"]["received"], 3);
    assert_eq!(r[2]["error"]["code"], "bad_offset", "a part sent two times");
    assert_eq!(r[3]["error"]["code"], "bad_request", "not complete");
    assert_eq!(r[4]["error"]["code"], "bad_request", "past the declared size");
    assert_eq!(r[5]["result"]["received"], 6);
    let path = r[6]["result"]["path"].as_str().unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"abcdef");
}

#[tokio::test]
async fn limits_the_size() {
    let home = tempfile::tempdir().unwrap();
    let r = call(home.path(), "files.put_begin", json!({"name": "big.mov", "size": uploads::MAX_CHUNKED_BYTES + 1})).await;
    assert_eq!(r["error"]["code"], "too_large");
    let r = call(home.path(), "files.put_begin", json!({"name": "max.mov", "size": uploads::MAX_CHUNKED_BYTES})).await;
    assert!(r["result"]["upload_id"].is_string(), "{r}");
    assert_eq!(uploads::MAX_CHUNKED_BYTES, 500 << 20);

    let id = begin(home.path(), "x.mov", 100 << 20).await;
    let big = vec![0u8; uploads::MAX_CHUNK_BYTES + 1];
    let r = call(home.path(), "files.put_chunk", json!({"upload_id": id, "offset": 0, "data_b64": b64(&big)})).await;
    assert_eq!(r["error"]["code"], "too_large");
}

#[test]
fn the_largest_part_fits_in_one_request_line() {
    const { assert!(uploads::MAX_CHUNK_BYTES.div_ceil(3) * 4 + 256 < rpc::MAX_LINE) };
    const { assert!(uploads::CHUNK_BYTES <= uploads::MAX_CHUNK_BYTES) };
}

#[tokio::test]
async fn bad_params() {
    let home = tempfile::tempdir().unwrap();
    for (method, params, code) in [
        ("files.put_begin", json!({"name": "...", "size": 1}), "bad_request"),
        ("files.put_begin", json!({"name": "a.mov"}), "bad_request"),
        ("files.put_begin", json!({"name": "a.mov", "size": -1}), "bad_request"),
        ("files.put_chunk", json!({"upload_id": "0123456789abcdef0123456789abcdef", "offset": 0, "data_b64": "AA=="}), "not_found"),
        ("files.put_chunk", json!({"upload_id": "../../.ssh/authorized_keys", "offset": 0, "data_b64": "AA=="}), "not_found"),
        ("files.put_chunk", json!({"upload_id": "0123456789abcdef0123456789abcdef", "data_b64": "AA=="}), "bad_request"),
        ("files.put_end", json!({"upload_id": "../x"}), "not_found"),
        ("files.put_end", json!({}), "bad_request"),
    ] {
        let r = call(home.path(), method, params.clone()).await;
        assert_eq!(r["error"]["code"], code, "{method} {params}: {r}");
    }
    let id = begin(home.path(), "a.mov", 3).await;
    let r = call(home.path(), "files.put_chunk", json!({"upload_id": id, "offset": 0, "data_b64": "not base64!"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn abort_deletes_the_partial_upload() {
    let home = tempfile::tempdir().unwrap();
    let id = begin(home.path(), "a.mov", 6).await;
    call(home.path(), "files.put_chunk", json!({"upload_id": id, "offset": 0, "data_b64": b64(b"abc")})).await;
    let r = call(home.path(), "files.put_abort", json!({"upload_id": id})).await;
    assert_eq!(r["result"], json!({}));
    assert_eq!(std::fs::read_dir(uploads::partial_dir(home.path())).unwrap().count(), 0);
    let r = call(home.path(), "files.put_chunk", json!({"upload_id": id, "offset": 3, "data_b64": b64(b"def")})).await;
    assert_eq!(r["error"]["code"], "not_found");
    // An unknown id gives the same result.
    let r = call(home.path(), "files.put_abort", json!({"upload_id": id})).await;
    assert_eq!(r["result"], json!({}));
}

#[tokio::test]
async fn limits_the_open_uploads_and_deletes_old_ones() {
    let home = tempfile::tempdir().unwrap();
    let mut ids = Vec::new();
    for i in 0..uploads::MAX_OPEN {
        ids.push(begin(home.path(), &format!("{i}.mov"), 10).await);
    }
    let r = call(home.path(), "files.put_begin", json!({"name": "more.mov", "size": 10})).await;
    assert_eq!(r["error"]["code"], "busy");

    // One upload got no part for more than an hour: the next begin deletes it and has room.
    let part = uploads::partial_dir(home.path()).join(format!("{}.part", ids[0]));
    let old = SystemTime::now() - uploads::PARTIAL_MAX_AGE - Duration::from_secs(60);
    std::fs::File::options().write(true).open(&part).unwrap().set_modified(old).unwrap();
    let r = call(home.path(), "files.put_begin", json!({"name": "more.mov", "size": 10})).await;
    assert!(r["result"]["upload_id"].is_string(), "{r}");
    assert!(!part.exists());
    assert!(!part.with_extension("json").exists());
    let r = call(home.path(), "files.put_chunk", json!({"upload_id": ids[0], "offset": 0, "data_b64": b64(b"x")})).await;
    assert_eq!(r["error"]["code"], "not_found");
}

#[test]
fn chunk_rules() {
    assert!(uploads::check_chunk(0, 10, 0, 4).is_ok());
    assert!(uploads::check_chunk(4, 10, 4, 6).is_ok());
    assert_eq!(uploads::check_chunk(4, 10, 0, 4).unwrap_err().code, "bad_offset");
    assert_eq!(uploads::check_chunk(4, 10, 8, 2).unwrap_err().code, "bad_offset");
    assert_eq!(uploads::check_chunk(4, 10, 4, 7).unwrap_err().code, "bad_request");
    assert_eq!(uploads::check_chunk(4, 10, 4, 0).unwrap_err().code, "bad_request");
    assert_eq!(uploads::check_chunk(0, u64::MAX, 0, uploads::MAX_CHUNK_BYTES + 1).unwrap_err().code, "too_large");
    assert!(uploads::valid_id("0123456789abcdef0123456789abcdef"));
    assert!(!uploads::valid_id("0123456789ABCDEF0123456789abcdef"));
    assert!(!uploads::valid_id("../0123456789abcdef0123456789ab"));
    assert!(!uploads::valid_id(""));
}

#[test]
fn the_methods_are_listed() {
    for m in ["files.put_begin", "files.put_chunk", "files.put_end", "files.put_abort"] {
        assert!(rpc::METHODS.contains(&m), "{m}");
    }
}
