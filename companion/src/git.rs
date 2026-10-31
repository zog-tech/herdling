//! Git views for the app: `git.status` (branch and changed files) and `git.diff` (the unified
//! diff of the changes), and `git.worktree_add`, which makes a worktree for a new session.
//!
//! The views run only read-only git commands. Each command has a timeout, a cap on its output,
//! optional locks off (`GIT_OPTIONAL_LOCKS=0`), and no external diff, text conversion or
//! fsmonitor program, so a view never changes the repo and never runs a program from its config.

use std::collections::HashMap;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::types::RpcError;

/// Bound for one read-only git command.
pub const TIMEOUT: Duration = Duration::from_secs(10);
/// Bound for `git worktree add`, which checks out every file.
pub const WORKTREE_TIMEOUT: Duration = Duration::from_secs(60);
/// Most changed files in a `git.status` result.
pub const MAX_FILES: usize = 1000;
/// Largest diff text in a `git.diff` result, in bytes.
pub const MAX_DIFF: usize = 512 * 1024;
/// Largest output read from `git status` or `git diff --numstat`.
const MAX_LIST_OUT: usize = 8 << 20;
/// Untracked files up to this size get line counts.
const COUNT_MAX_BYTES: u64 = 512 * 1024;
/// The folder under the repo root that holds the worktrees made by `git.worktree_add`.
pub const WORKTREES_DIR: &str = ".worktrees";

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// The output of one git command.
struct Output {
    stdout: Vec<u8>,
    /// True when the output was longer than the cap. The command was stopped.
    truncated: bool,
    code: Option<i32>,
    stderr: String,
}

impl Output {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    fn failed(&self, what: &str) -> RpcError {
        let msg = self.stderr.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        err("command_failed", if msg.is_empty() { format!("{what} failed") } else { format!("{what}: {msg}") })
    }
}

/// Runs `git -C <dir> <args>` and reads at most `cap` bytes of its output.
async fn git(dir: &Path, args: &[&str], cap: usize, timeout: Duration) -> Result<Output, RpcError> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "-c", "color.ui=false"])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        // A caller's git environment must not point the command at another repo.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => err("not_installed", "git is not installed on this computer"),
        _ => err("io_error", format!("git: {e}")),
    })?;
    let mut stdout = child.stdout.take().ok_or_else(|| err("internal", "git: no stdout"))?;
    let mut stderr = child.stderr.take().ok_or_else(|| err("internal", "git: no stderr"))?;
    // Read stderr on its own task: a stopped stdout read must not block it.
    let errs = tokio::spawn(async move {
        let mut b = Vec::new();
        let _ = stderr.read_to_end(&mut b).await;
        b
    });
    let run = async {
        let mut buf = Vec::new();
        (&mut stdout).take(cap as u64 + 1).read_to_end(&mut buf).await?;
        let truncated = buf.len() > cap;
        if truncated {
            buf.truncate(cap);
            let _ = child.start_kill();
        }
        drop(stdout);
        let status = child.wait().await?;
        Ok::<_, io::Error>((buf, truncated, status.code()))
    };
    let (stdout, truncated, code) = match tokio::time::timeout(timeout, run).await {
        Err(_) => return Err(err("timeout", format!("git {} took longer than {} s", args.first().unwrap_or(&""), timeout.as_secs()))),
        Ok(Err(e)) => return Err(err("io_error", format!("git: {e}"))),
        Ok(Ok(r)) => r,
    };
    let stderr = String::from_utf8_lossy(&errs.await.unwrap_or_default()).into_owned();
    Ok(Output { stdout, truncated, code, stderr })
}

/// The root of the work tree that holds `cwd`. `None` when `cwd` is not in a git work tree.
pub async fn toplevel(cwd: &Path) -> Result<Option<PathBuf>, RpcError> {
    if !cwd.is_dir() {
        return Err(err("not_found", format!("no such folder: {}", cwd.display())));
    }
    let out = git(cwd, &["rev-parse", "--show-toplevel"], 64 * 1024, TIMEOUT).await?;
    if out.code != Some(0) {
        return Ok(None);
    }
    let root = out.text().trim_end_matches(['\n', '\r']).to_string();
    Ok((!root.is_empty()).then(|| PathBuf::from(root)))
}

/// True when the repo has a commit at `HEAD`.
async fn has_head(root: &Path) -> Result<bool, RpcError> {
    Ok(git(root, &["rev-parse", "--verify", "--quiet", "HEAD"], 1024, TIMEOUT).await?.code == Some(0))
}

/// The branch line of `git status --porcelain=v2 --branch`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct BranchInfo {
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    /// The commit, `None` before the first commit.
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

/// One changed file in `git.status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChangedFile {
    /// Path from the repo root, with `/`.
    pub path: String,
    /// The old path of a renamed or copied file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
    /// One letter: `M` changed, `A` added, `D` deleted, `R` renamed, `C` copied, `U` conflict, `?` untracked.
    pub status: String,
    /// True when the index has changes of this file.
    pub staged: bool,
    /// True when the work tree has changes of this file that are not in the index.
    pub unstaged: bool,
    /// Lines added and deleted, staged and unstaged together. `None` when unknown (binary or too large).
    pub added: Option<u64>,
    pub deleted: Option<u64>,
    pub binary: bool,
}

/// `git.status` result.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    /// False when the folder is not in a git work tree. Then every other field is empty.
    pub is_repo: bool,
    /// The root of the work tree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    /// The short commit id of HEAD.
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<ChangedFile>,
    /// True when there were more than [`MAX_FILES`] changed files.
    pub truncated: bool,
}

impl Status {
    fn not_a_repo() -> Status {
        Status { is_repo: false, root: None, branch: None, head: None, upstream: None, ahead: 0, behind: 0, files: Vec::new(), truncated: false }
    }
}

/// The letter of a porcelain `XY` pair. The index letter wins over the work tree letter.
fn letter(xy: &str) -> String {
    let mut c = xy.chars();
    let (x, y) = (c.next().unwrap_or('.'), c.next().unwrap_or('.'));
    let l = if x != '.' { x } else { y };
    match l {
        'T' => "M".into(),
        '.' => "M".into(),
        other => other.to_string(),
    }
}

/// Parses the output of `git status --porcelain=v2 --branch -z`.
pub fn parse_status(raw: &str) -> (BranchInfo, Vec<ChangedFile>) {
    let mut b = BranchInfo::default();
    let mut files = Vec::new();
    let mut parts = raw.split('\0').filter(|s| !s.is_empty());
    let file = |path: &str, orig: Option<String>, status: String, staged: bool, unstaged: bool| ChangedFile {
        path: path.to_string(),
        orig_path: orig,
        status,
        staged,
        unstaged,
        added: None,
        deleted: None,
        binary: false,
    };
    while let Some(entry) = parts.next() {
        if let Some(h) = entry.strip_prefix("# ") {
            let (k, v) = h.split_once(' ').unwrap_or((h, ""));
            match k {
                "branch.oid" if v != "(initial)" => b.oid = Some(v.to_string()),
                "branch.head" if v != "(detached)" => b.branch = Some(v.to_string()),
                "branch.upstream" => b.upstream = Some(v.to_string()),
                "branch.ab" => {
                    for n in v.split(' ') {
                        if let Some(a) = n.strip_prefix('+') {
                            b.ahead = a.parse().unwrap_or(0);
                        } else if let Some(d) = n.strip_prefix('-') {
                            b.behind = d.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = entry.as_bytes()[0];
        match kind {
            b'1' => {
                let f: Vec<&str> = entry.splitn(9, ' ').collect();
                if f.len() == 9 {
                    let xy = f[1];
                    files.push(file(f[8], None, letter(xy), !xy.starts_with('.'), !xy.ends_with('.')));
                }
            }
            b'2' => {
                let f: Vec<&str> = entry.splitn(10, ' ').collect();
                let orig = parts.next().map(String::from);
                if f.len() == 10 {
                    let xy = f[1];
                    files.push(file(f[9], orig, letter(xy), !xy.starts_with('.'), !xy.ends_with('.')));
                }
            }
            b'u' => {
                let f: Vec<&str> = entry.splitn(11, ' ').collect();
                if f.len() == 11 {
                    files.push(file(f[10], None, "U".into(), true, true));
                }
            }
            b'?' => {
                if let Some(p) = entry.strip_prefix("? ") {
                    files.push(file(p, None, "?".into(), false, true));
                }
            }
            _ => {}
        }
    }
    (b, files)
}

/// Lines added and deleted. `None` for a binary file.
pub type Counts = Option<(u64, u64)>;

/// Line counts per path from `git diff --numstat -z`.
pub fn parse_numstat(raw: &str) -> HashMap<String, Counts> {
    let mut out = HashMap::new();
    let mut parts = raw.split('\0');
    while let Some(rec) = parts.next() {
        if rec.is_empty() {
            continue;
        }
        let mut f = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (f.next(), f.next(), f.next()) else { continue };
        // A rename has an empty path field, then the old and the new path.
        let path = if path.is_empty() {
            let _old = parts.next();
            match parts.next() {
                Some(p) => p,
                None => break,
            }
        } else {
            path
        };
        let counts = match (a.parse::<u64>(), d.parse::<u64>()) {
            (Ok(a), Ok(d)) => Some((a, d)),
            _ => None,
        };
        out.insert(path.to_string(), counts);
    }
    out
}

/// Lines of a small untracked text file. `None` for a binary or too large file.
fn count_lines(path: &Path) -> Option<(u64, bool)> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > COUNT_MAX_BYTES {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    if data.contains(&0) {
        return Some((0, true));
    }
    let mut n = data.iter().filter(|c| **c == b'\n').count() as u64;
    if data.last().is_some_and(|c| *c != b'\n') {
        n += 1;
    }
    Some((n, false))
}

/// `git.status` for the work tree that holds `cwd`.
pub async fn status(cwd: &Path) -> Result<Status, RpcError> {
    let Some(root) = toplevel(cwd).await? else { return Ok(Status::not_a_repo()) };
    let out = git(&root, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--no-renames"], MAX_LIST_OUT, TIMEOUT).await?;
    if out.code != Some(0) {
        return Err(out.failed("git status"));
    }
    let (b, mut files) = parse_status(&out.text());
    let mut truncated = out.truncated;
    if files.len() > MAX_FILES {
        files.truncate(MAX_FILES);
        truncated = true;
    }
    // Per path: the work tree counts and the index counts.
    let mut counts: HashMap<String, (Counts, Counts)> = HashMap::new();
    let numstat = ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"];
    let staged_args: Vec<&str> = numstat.iter().copied().chain(["--cached"]).collect();
    // Before the first commit, `--cached` still works: it compares the index with an empty tree.
    for (i, args) in [numstat.to_vec(), staged_args].into_iter().enumerate() {
        let o = git(&root, &args, MAX_LIST_OUT, TIMEOUT).await?;
        if o.code != Some(0) {
            continue;
        }
        for (path, c) in parse_numstat(&o.text()) {
            let e = counts.entry(path).or_insert((Some((0, 0)), Some((0, 0))));
            if i == 0 { e.0 = c } else { e.1 = c }
        }
    }
    for f in &mut files {
        if f.status == "?" {
            if let Some((n, binary)) = count_lines(&root.join(&f.path)) {
                f.binary = binary;
                if !binary {
                    (f.added, f.deleted) = (Some(n), Some(0));
                }
            }
            continue;
        }
        if let Some((w, s)) = counts.get(&f.path) {
            match (w, s) {
                (Some(w), Some(s)) => (f.added, f.deleted) = (Some(w.0 + s.0), Some(w.1 + s.1)),
                _ => f.binary = true,
            }
        }
    }
    Ok(Status {
        is_repo: true,
        root: Some(root.to_string_lossy().into_owned()),
        branch: b.branch,
        head: b.oid.map(|o| o.chars().take(7).collect()),
        upstream: b.upstream,
        ahead: b.ahead,
        behind: b.behind,
        files,
        truncated,
    })
}

/// Refuses a path that is empty, absolute, or that leaves the repo root with `..`.
pub fn check_path(path: &str) -> Result<(), RpcError> {
    let bad = || err("bad_request", "path must be a relative path inside the repo");
    if path.is_empty() || path.contains('\0') {
        return Err(bad());
    }
    for c in Path::new(path).components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(bad()),
        }
    }
    Ok(())
}

/// Also refuses a path whose real location (through symbolic links) is outside the root.
fn check_inside(root: &Path, path: &str) -> Result<(), RpcError> {
    check_path(path)?;
    let full = root.join(path);
    // A deleted file does not exist: check the nearest folder that does.
    let mut probe = full.as_path();
    while !probe.exists() {
        match probe.parent() {
            Some(p) => probe = p,
            None => return Ok(()),
        }
    }
    let (Ok(real), Ok(real_root)) = (probe.canonicalize(), root.canonicalize()) else { return Ok(()) };
    if real.starts_with(&real_root) {
        Ok(())
    } else {
        Err(err("bad_request", "path must be a relative path inside the repo"))
    }
}

/// `git.diff` result.
#[derive(Debug, Clone, Serialize)]
pub struct Diff {
    /// Unified diff text. A binary file shows as one `Binary files ... differ` line.
    pub diff: String,
    /// True when the diff was longer than [`MAX_DIFF`] bytes and was cut.
    pub truncated: bool,
    /// The root of the work tree.
    pub root: String,
}

/// The diff of the work tree that holds `cwd`. `path` limits it to one file. `staged`: `Some(true)`
/// gives the index against HEAD, `Some(false)` the work tree against the index, and `None` both
/// together. An untracked `path` shows as a new file.
pub async fn diff(cwd: &Path, path: Option<&str>, staged: Option<bool>) -> Result<Diff, RpcError> {
    let root = toplevel(cwd).await?.ok_or_else(|| err("not_a_repo", "the folder is not in a git repo"))?;
    if let Some(p) = path {
        check_inside(&root, p)?;
    }
    let base = ["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M"];
    let run = |extra: &[&'static str]| -> Vec<&str> {
        let mut args: Vec<&str> = base.to_vec();
        args.extend_from_slice(extra);
        args.push("--");
        args.extend(path);
        args
    };
    let mut text = String::new();
    let mut truncated = false;
    let mut add = |o: &Output, text: &mut String| {
        text.push_str(&o.text());
        truncated |= o.truncated;
    };
    let head = staged.is_none() && has_head(&root).await?;
    let plans: Vec<Vec<&str>> = match staged {
        Some(true) => vec![run(&["--cached"])],
        Some(false) => vec![run(&[])],
        None if head => vec![run(&["HEAD"])],
        // Before the first commit there is no HEAD: the index, then the work tree.
        None => vec![run(&["--cached"]), run(&[])],
    };
    for args in plans {
        let o = git(&root, &args, MAX_DIFF.saturating_sub(text.len()).max(1), TIMEOUT).await?;
        // A cut output ends with a stopped command: its exit code does not count.
        if o.code != Some(0) && !o.truncated {
            return Err(o.failed("git diff"));
        }
        add(&o, &mut text);
    }
    if let (Some(p), false, true) = (path, staged == Some(true), text.is_empty()) {
        let o = git(&root, &["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", p], 64 * 1024, TIMEOUT).await?;
        if !o.stdout.is_empty() {
            // `--no-index` ends with code 1 when the files differ.
            let args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-index", "--", "/dev/null", p];
            let o = git(&root, &args, MAX_DIFF, TIMEOUT).await?;
            if !matches!(o.code, Some(0) | Some(1)) && !o.truncated {
                return Err(o.failed("git diff"));
            }
            add(&o, &mut text);
        }
    }
    if text.len() > MAX_DIFF {
        let mut cut = MAX_DIFF;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        truncated = true;
    }
    if truncated {
        // Keep whole lines only.
        if let Some(i) = text.rfind('\n') {
            text.truncate(i + 1);
        }
    }
    Ok(Diff { diff: text, truncated, root: root.to_string_lossy().into_owned() })
}

/// `git.worktree_add` result.
#[derive(Debug, Clone, Serialize)]
pub struct Worktree {
    /// The folder of the new worktree: `<root>/.worktrees/<branch with '/' as '-'>`.
    pub path: String,
    pub branch: String,
    /// The root of the repo the worktree came from.
    pub root: String,
}

/// The folder name of a worktree for `branch`: `/` becomes `-`, other unusual chars become `_`.
pub fn worktree_slug(branch: &str) -> String {
    branch
        .chars()
        .map(|c| match c {
            '/' => '-',
            c if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') => c,
            _ => '_',
        })
        .collect::<String>()
        .trim_start_matches(['.', '-'])
        .to_string()
}

/// Makes a new branch from HEAD and checks it out in `<root>/.worktrees/<slug>`. Adds
/// `/.worktrees/` to the repo's `info/exclude`, so the main work tree does not show it.
pub async fn worktree_add(cwd: &Path, branch: &str) -> Result<Worktree, RpcError> {
    let branch = branch.trim();
    if branch.is_empty() || branch.starts_with('-') || branch.len() > 200 || branch == "@" || branch == "HEAD" {
        return Err(err("bad_request", format!("\"{branch}\" is not a valid branch name")));
    }
    let root = toplevel(cwd).await?.ok_or_else(|| err("not_a_repo", "the folder is not in a git repo"))?;
    // The full ref name: `--branch` would expand `@{-1}` and similar forms.
    let check = git(&root, &["check-ref-format", &format!("refs/heads/{branch}")], 1024, TIMEOUT).await?;
    if check.code != Some(0) {
        return Err(err("bad_request", format!("\"{branch}\" is not a valid branch name")));
    }
    if !has_head(&root).await? {
        return Err(err("command_failed", "the repo has no commits yet. Make a first commit, then try again"));
    }
    let exists = git(&root, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")], 1024, TIMEOUT).await?;
    if exists.code == Some(0) {
        return Err(err("already_exists", format!("a branch named \"{branch}\" already exists")));
    }
    let slug = worktree_slug(branch);
    if slug.is_empty() {
        return Err(err("bad_request", "the branch name is not valid"));
    }
    let path = root.join(WORKTREES_DIR).join(&slug);
    if path.exists() {
        return Err(err("already_exists", format!("the folder {} already exists", path.display())));
    }
    let path_s = path.to_string_lossy().into_owned();
    let out = git(&root, &["worktree", "add", "-b", branch, "--", &path_s, "HEAD"], 64 * 1024, WORKTREE_TIMEOUT).await?;
    if out.code != Some(0) {
        return Err(out.failed("git worktree add"));
    }
    exclude_worktrees(&root).await;
    Ok(Worktree { path: path_s, branch: branch.to_string(), root: root.to_string_lossy().into_owned() })
}

/// Adds `/.worktrees/` to `info/exclude` of the repo. Best effort: a failure only makes the
/// folder show as untracked in the main work tree.
async fn exclude_worktrees(root: &Path) {
    let Ok(out) = git(root, &["rev-parse", "--git-common-dir"], 64 * 1024, TIMEOUT).await else { return };
    if out.code != Some(0) {
        return;
    }
    let common = PathBuf::from(out.text().trim_end_matches(['\n', '\r']));
    let common = if common.is_absolute() { common } else { root.join(common) };
    let file = common.join("info").join("exclude");
    let line = format!("/{WORKTREES_DIR}/");
    let old = std::fs::read_to_string(&file).unwrap_or_default();
    if old.lines().any(|l| l.trim() == line) {
        return;
    }
    let _ = std::fs::create_dir_all(common.join("info"));
    let sep = if old.is_empty() || old.ends_with('\n') { "" } else { "\n" };
    let _ = std::fs::write(&file, format!("{old}{sep}# Worktrees made by Herdling\n{line}\n"));
}
