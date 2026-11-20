//! `files.get`: the pure rules of `herdlingd::files` and the RPC call on a temporary folder.

use std::path::{Path, PathBuf};

use base64::Engine;
use herdlingd::files::{self, Entry};
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn call(home: &Path, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 20);
    let (server_out, client_rx) = tokio::io::duplex(4 << 20);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(home.into())));
    let req = json!({"id": 1, "method": "files.get", "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    serde_json::from_str(&BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap()).unwrap()
}

#[test]
fn resolve_paths() {
    let home = Path::new("/home/sam");
    let cwd = Path::new("/home/sam/proj");
    assert_eq!(files::resolve(home, "~", None).unwrap(), PathBuf::from("/home/sam"));
    assert_eq!(files::resolve(home, "~/apps/proj", None).unwrap(), PathBuf::from("/home/sam/apps/proj"));
    assert_eq!(files::resolve(home, "/etc/hosts", None).unwrap(), PathBuf::from("/etc/hosts"));
    assert_eq!(files::resolve(home, "src/content/", Some(cwd)).unwrap(), PathBuf::from("/home/sam/proj/src/content/"));
    assert_eq!(files::resolve(home, "  README.md ", Some(cwd)).unwrap(), PathBuf::from("/home/sam/proj/README.md"));
    assert!(files::resolve(home, "src/a.ts", None).is_err());
    assert!(files::resolve(home, "src/a.ts", Some(Path::new("rel"))).is_err());
    assert!(files::resolve(home, "", None).is_err());
    assert!(files::resolve(home, "~root/x", None).is_err());
    assert!(files::is_relative("src/a"));
    assert!(!files::is_relative("/a"));
    assert!(!files::is_relative("~/a"));
}

#[test]
fn kinds_from_names() {
    assert_eq!(files::image_mime("a.PNG"), Some("image/png"));
    assert_eq!(files::image_mime("photo.jpeg"), Some("image/jpeg"));
    assert_eq!(files::image_mime("x.heic"), Some("image/heic"));
    assert_eq!(files::image_mime("notes.txt"), None);
    assert_eq!(files::image_mime(".png"), None);
    assert_eq!(files::image_mime("png"), None);
    assert_eq!(files::other_mime("doc.pdf"), Some("application/pdf"));
    assert_eq!(files::entry_kind("src", true), "dir");
    assert_eq!(files::entry_kind("a.webp", false), "image");
    assert_eq!(files::entry_kind("a.rs", false), "file");
}

#[test]
fn text_check() {
    assert!(files::looks_text(b"hello\nworld"));
    assert!(files::looks_text(b""));
    assert!(files::looks_text("caf\u{e9}".as_bytes()));
    // A character cut at the end of the sniffed bytes is still text.
    assert!(files::looks_text(&"\u{e9}".as_bytes()[..1]));
    assert!(!files::looks_text(b"a\0b"));
    assert!(!files::looks_text(&[0xff, 0xfe, 0x41]));
}

#[test]
fn cut_on_a_char_boundary() {
    assert_eq!(files::cut_text(b"abc", 3), ("abc".to_string(), false));
    assert_eq!(files::cut_text(b"abcd", 3), ("abc".to_string(), true));
    // "é" is two bytes: a cut inside it drops the whole character.
    assert_eq!(files::cut_text("a\u{e9}b".as_bytes(), 2), ("a".to_string(), true));
}

#[test]
fn order_dirs_first_and_hidden() {
    let e = |n: &str, d: bool| Entry { name: n.into(), is_dir: d };
    let all = vec![e("b.txt", false), e("Src", true), e(".git", true), e("a.txt", false), e("docs", true), e(".env", false)];
    let names = |v: Vec<Entry>| v.into_iter().map(|e| e.name).collect::<Vec<_>>();
    assert_eq!(names(files::order(all.clone(), false)), ["docs", "Src", "a.txt", "b.txt"]);
    assert_eq!(names(files::order(all, true)), [".git", "docs", "Src", ".env", "a.txt", "b.txt"]);
}

#[tokio::test]
async fn lists_a_folder() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj/docs");
    std::fs::create_dir_all(dir.join("screens")).unwrap();
    std::fs::create_dir_all(dir.join(".cache")).unwrap();
    std::fs::write(dir.join("home-dark.png"), b"png").unwrap();
    std::fs::write(dir.join("README.md"), b"# hi\n").unwrap();
    let r = call(home.path(), json!({"path": "~/proj/docs"})).await;
    let res = &r["result"];
    assert_eq!(res["kind"], "dir", "{r}");
    assert_eq!(res["name"], "docs");
    assert_eq!(res["truncated"], false);
    assert_eq!(
        res["entries"],
        json!([
            {"name": "screens", "kind": "dir"},
            {"name": "home-dark.png", "kind": "image", "size": 3},
            {"name": "README.md", "kind": "file", "size": 5},
        ])
    );
    let r = call(home.path(), json!({"path": "~/proj/docs", "hidden": true})).await;
    assert_eq!(r["result"]["entries"][0]["name"], ".cache");
}

#[tokio::test]
async fn relative_paths_use_cwd() {
    let home = tempfile::tempdir().unwrap();
    let proj = home.path().join("proj");
    std::fs::create_dir_all(proj.join("src")).unwrap();
    std::fs::write(proj.join("src/a.ts"), "const a = 1;\n").unwrap();
    let r = call(home.path(), json!({"path": "src/a.ts", "cwd": proj.to_string_lossy()})).await;
    assert_eq!(r["result"]["kind"], "text", "{r}");
    assert_eq!(r["result"]["text"], "const a = 1;\n");
    assert_eq!(r["result"]["truncated"], false);
    assert_eq!(r["result"]["size"], 13);
    // No cwd and no pane: the call cannot place the path.
    let r = call(home.path(), json!({"path": "src/a.ts"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn cuts_long_text() {
    let home = tempfile::tempdir().unwrap();
    let long = "x".repeat(files::TEXT_MAX + 10);
    std::fs::write(home.path().join("big.log"), &long).unwrap();
    let r = call(home.path(), json!({"path": "~/big.log"})).await;
    assert_eq!(r["result"]["truncated"], true);
    assert_eq!(r["result"]["text"].as_str().unwrap().len(), files::TEXT_MAX);
    assert_eq!(r["result"]["size"], (files::TEXT_MAX + 10) as u64);
}

#[tokio::test]
async fn sends_an_image_in_parts() {
    let home = tempfile::tempdir().unwrap();
    let bytes: Vec<u8> = (0..files::CHUNK + 100).map(|i| (i % 251) as u8).collect();
    std::fs::write(home.path().join("shot.png"), &bytes).unwrap();
    let b64 = base64::engine::general_purpose::STANDARD;
    let r = call(home.path(), json!({"path": "~/shot.png"})).await;
    let res = &r["result"];
    assert_eq!(res["kind"], "image", "{r}");
    assert_eq!(res["mime"], "image/png");
    assert_eq!(res["offset"], 0);
    assert_eq!(res["eof"], false);
    let first = b64.decode(res["data_b64"].as_str().unwrap()).unwrap();
    assert_eq!(first.len(), files::CHUNK);
    let r = call(home.path(), json!({"path": "~/shot.png", "offset": files::CHUNK})).await;
    assert_eq!(r["result"]["eof"], true);
    let rest = b64.decode(r["result"]["data_b64"].as_str().unwrap()).unwrap();
    assert_eq!([first, rest].concat(), bytes);
}

#[tokio::test]
async fn refuses_a_huge_image_but_names_it() {
    let home = tempfile::tempdir().unwrap();
    let f = std::fs::File::create(home.path().join("huge.jpg")).unwrap();
    f.set_len(files::IMAGE_MAX + 1).unwrap();
    let r = call(home.path(), json!({"path": "~/huge.jpg"})).await;
    assert_eq!(r["result"]["too_large"], true, "{r}");
    assert!(r["result"].get("data_b64").is_none());
}

#[tokio::test]
async fn binary_is_other() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join("doc.pdf"), b"%PDF\0\x01\x02").unwrap();
    let r = call(home.path(), json!({"path": "~/doc.pdf"})).await;
    assert_eq!(r["result"]["kind"], "other", "{r}");
    assert_eq!(r["result"]["mime"], "application/pdf");
    assert!(r["result"].get("text").is_none());
}

#[tokio::test]
async fn missing_path() {
    let home = tempfile::tempdir().unwrap();
    let r = call(home.path(), json!({"path": "~/nope/x.md"})).await;
    assert_eq!(r["error"]["code"], "not_found", "{r}");
    let r = call(home.path(), json!({})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[cfg(unix)]
#[tokio::test]
async fn a_fifo_is_not_read() {
    let home = tempfile::tempdir().unwrap();
    let fifo = home.path().join("pipe");
    let ok = std::process::Command::new("mkfifo").arg(&fifo).status().map(|s| s.success()).unwrap_or(false);
    if !ok {
        return;
    }
    let r = tokio::time::timeout(std::time::Duration::from_secs(5), call(home.path(), json!({"path": "~/pipe"}))).await.expect("no block");
    assert_eq!(r["result"]["kind"], "other", "{r}");
}
