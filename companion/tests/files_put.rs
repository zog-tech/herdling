use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::rpc::{self, Ctx};
use zogsshd::uploads;

fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

async fn call(home: &Path, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 20);
    let (server_out, client_rx) = tokio::io::duplex(1 << 20);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(home.join("none.sock"), home.into())));
    let req = json!({"id": 1, "method": "files.put", "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    serde_json::from_str(&BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap()).unwrap()
}

#[tokio::test]
async fn writes_the_file_private() {
    let home = tempfile::tempdir().unwrap();
    let r = call(home.path(), json!({"name": "photo 1.jpg", "data_b64": b64(b"jpeg bytes")})).await;
    let path = PathBuf::from(r["result"]["path"].as_str().unwrap());
    assert_eq!(path.parent().unwrap(), uploads::dir(home.path()));
    let file = path.file_name().unwrap().to_str().unwrap();
    let (ms, rest) = file.split_once('-').unwrap();
    assert!(ms.parse::<u128>().is_ok());
    assert_eq!(rest, "photo_1.jpg");
    assert_eq!(std::fs::read(&path).unwrap(), b"jpeg bytes");
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);

    // Same name again at once: a second file, not an error.
    let r2 = call(home.path(), json!({"name": "photo 1.jpg", "data_b64": b64(b"two")})).await;
    assert_ne!(r2["result"]["path"], r["result"]["path"]);
}

#[tokio::test]
async fn refuses_more_than_the_cap() {
    let home = tempfile::tempdir().unwrap();
    let big = vec![0u8; uploads::MAX_BYTES + 1];
    let r = call(home.path(), json!({"name": "big.bin", "data_b64": b64(&big)})).await;
    assert_eq!(r["error"]["code"], "too_large");
    let exact = vec![0u8; uploads::MAX_BYTES];
    let r = call(home.path(), json!({"name": "ok.bin", "data_b64": b64(&exact)})).await;
    assert!(r["result"]["path"].is_string(), "{r}");
}

#[tokio::test]
async fn bad_params() {
    let home = tempfile::tempdir().unwrap();
    for params in [
        json!({"name": "", "data_b64": b64(b"x")}),
        json!({"name": "...", "data_b64": b64(b"x")}),
        json!({"name": "a.txt", "data_b64": "not base64!"}),
        json!({"name": "a.txt"}),
    ] {
        let r = call(home.path(), params.clone()).await;
        assert_eq!(r["error"]["code"], "bad_request", "{params}");
    }
}

#[test]
fn sanitize_names() {
    assert_eq!(uploads::sanitize("IMG_0001.HEIC").as_deref(), Some("IMG_0001.HEIC"));
    assert_eq!(uploads::sanitize("my photo (1).jpg").as_deref(), Some("my_photo__1_.jpg"));
    assert_eq!(uploads::sanitize("ünï.png").as_deref(), Some("_n_.png"));
    assert_eq!(uploads::sanitize(".hidden").as_deref(), Some("hidden"));
    assert_eq!(uploads::sanitize(""), None);
    assert_eq!(uploads::sanitize("/"), None);
    let long = format!("{}.jpeg", "a".repeat(100));
    let s = uploads::sanitize(&long).unwrap();
    assert_eq!(s.len(), uploads::MAX_NAME);
    assert!(s.ends_with(".jpeg"));
}

#[tokio::test]
async fn path_traversal_stays_in_the_upload_dir() {
    let home = tempfile::tempdir().unwrap();
    for name in ["../../evil.sh", "..\\..\\evil.sh", "/etc/passwd", "a/../../b.txt"] {
        let r = call(home.path(), json!({"name": name, "data_b64": b64(b"x")})).await;
        let path = PathBuf::from(r["result"]["path"].as_str().unwrap());
        assert_eq!(path.parent().unwrap(), uploads::dir(home.path()), "{name}");
        assert!(!path.file_name().unwrap().to_str().unwrap().contains(".."), "{name}");
    }
    assert!(!home.path().join("evil.sh").exists());
}

#[tokio::test]
async fn deletes_old_uploads() {
    let home = tempfile::tempdir().unwrap();
    let dir = uploads::dir(home.path());
    std::fs::create_dir_all(&dir).unwrap();
    let old = dir.join("1-old.jpg");
    let fresh = dir.join("2-fresh.jpg");
    std::fs::write(&old, b"old").unwrap();
    std::fs::write(&fresh, b"fresh").unwrap();
    let eight_days = SystemTime::now() - Duration::from_secs(8 * 24 * 3600);
    std::fs::File::options().write(true).open(&old).unwrap().set_modified(eight_days).unwrap();

    let r = call(home.path(), json!({"name": "new.jpg", "data_b64": b64(b"new")})).await;
    assert!(r["result"]["path"].is_string());
    assert!(!old.exists());
    assert!(fresh.exists());
}
