//! The git repo of each terminal folder, for the groups of the snapshot.
//!
//! One lookup runs `git` once for each folder, in parallel, and has a time limit. A cache that
//! all snapshots share keeps a burst of snapshots from running `git` again. A folder that is
//! not in a repo, does not exist or answers too late has no repo, and its group falls back to
//! the folder name.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::groups::{RepoInfo, Repos};
use crate::git;

/// How long a result stays in the cache.
const TTL: Duration = Duration::from_secs(30);
/// The time limit for the lookup of one folder.
const FOLDER_TIMEOUT: Duration = Duration::from_secs(2);

type Cache = HashMap<String, (Instant, Option<RepoInfo>)>;

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached(folder: &str) -> Option<Option<RepoInfo>> {
    let map = cache().lock().ok()?;
    map.get(folder).filter(|(at, _)| at.elapsed() < TTL).map(|(_, info)| info.clone())
}

fn store(folder: &str, info: &Option<RepoInfo>) {
    if let Ok(mut map) = cache().lock() {
        // Old entries leave on each insert, so the map cannot grow without bound.
        map.retain(|_, (at, _)| at.elapsed() < TTL);
        map.insert(folder.to_string(), (Instant::now(), info.clone()));
    }
}

/// The repo facts of one folder. None when git gives no repo.
async fn find(folder: &str) -> Option<RepoInfo> {
    let root = git::toplevel(Path::new(folder)).await.ok().flatten()?;
    let name = root.file_name()?.to_string_lossy().into_owned();
    if name.is_empty() {
        return None;
    }
    let branch = git::branch(&root).await;
    Some(RepoInfo { root: root.to_string_lossy().into_owned(), name, branch })
}

/// One entry for each of `folders`. The lookups run in parallel.
pub async fn lookup(folders: &[String]) -> Repos {
    let mut out = Repos::new();
    let mut tasks = tokio::task::JoinSet::new();
    for f in folders {
        if let Some(hit) = cached(f) {
            out.insert(f.clone(), hit);
            continue;
        }
        let f = f.clone();
        tasks.spawn(async move {
            match tokio::time::timeout(FOLDER_TIMEOUT, find(&f)).await {
                Ok(info) => {
                    store(&f, &info);
                    (f, info)
                }
                // A late answer is not cached: the next snapshot tries again.
                Err(_) => (f, None),
            }
        });
    }
    while let Some(Ok((f, info))) = tasks.join_next().await {
        out.insert(f, info);
    }
    out
}
