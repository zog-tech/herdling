//! `commands.list`: the slash commands and skills that Claude Code offers in a folder.
//!
//! Sources: Claude Code built-ins, user and project skills and commands, and the skills and
//! commands of enabled plugins. A missing or unreadable file or folder is skipped.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// Bytes read from each file to find the frontmatter.
const HEAD_BYTES: u64 = 4096;
/// Maximum entries in one reply.
pub const MAX_COMMANDS: usize = 500;
/// Maximum folder depth under a `commands` folder. Stops symlink loops.
const MAX_DEPTH: usize = 6;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Command {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: &'static str,
}

/// Common Claude Code built-ins. Claude Code has more; these are the ones used most.
const BUILTINS: &[(&str, &str)] = &[
    ("clear", "Clear the conversation history"),
    ("compact", "Summarize the conversation to free context"),
    ("context", "Show how the context window is used"),
    ("cost", "Show the token cost of this session"),
    ("help", "Show help and the available commands"),
    ("init", "Write a CLAUDE.md for this project"),
    ("model", "Change the model"),
    ("resume", "Resume an earlier conversation"),
    ("review", "Review a pull request"),
];

/// All commands for `cwd` (none from the project when `cwd` is `None`), sorted by name.
/// When two have the same name, project beats user, user beats plugin, plugin beats built-in.
pub fn list(home: &Path, cwd: Option<&Path>) -> Vec<Command> {
    let mut by_name: HashMap<String, Command> = HashMap::new();
    // Add from the lowest priority to the highest: a later insert replaces an earlier one.
    let mut add = |found: Vec<Command>| {
        for c in found {
            by_name.insert(c.name.clone(), c);
        }
    };
    add(BUILTINS
        .iter()
        .map(|(n, d)| Command { name: (*n).into(), description: Some((*d).into()), source: "builtin" })
        .collect());
    add(plugins(home));
    add(from_claude_dir(&home.join(".claude"), "user", ""));
    if let Some(cwd) = cwd {
        // The folder nearest to `cwd` wins, so add the farthest first.
        for dir in project_dirs(home, cwd).iter().rev() {
            add(from_claude_dir(&dir.join(".claude"), "project", ""));
        }
    }
    let mut out: Vec<Command> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.truncate(MAX_COMMANDS);
    out
}

/// `cwd` and its parents up to the git root (the first folder with `.git`). Only `cwd`
/// when no git root is found. The home folder is never a project folder.
fn project_dirs(home: &Path, cwd: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for dir in cwd.ancestors() {
        if dir == home {
            break;
        }
        dirs.push(dir.to_path_buf());
        if dir.join(".git").exists() {
            return dirs;
        }
    }
    if cwd == home {
        return Vec::new();
    }
    vec![cwd.to_path_buf()]
}

/// Skills and commands under one `.claude` folder (or plugin folder), names prefixed with `prefix`.
fn from_claude_dir(dir: &Path, source: &'static str, prefix: &str) -> Vec<Command> {
    let mut out = skills(&dir.join("skills"), source, prefix);
    let commands_dir = dir.join("commands");
    walk_commands(&commands_dir, &commands_dir, 0, &mut |rel, path| {
        let head = read_head(path);
        let (front, body) = head.as_deref().map(split_frontmatter).unwrap_or_default();
        let description = front
            .as_ref()
            .and_then(|f| f.get("description").cloned())
            .or_else(|| body.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from));
        out.push(Command { name: format!("{prefix}{rel}"), description: clean(description), source });
    });
    out
}

/// `<dir>/<name>/SKILL.md`. The name comes from the frontmatter, else from the folder.
fn skills(dir: &Path, source: &'static str, prefix: &str) -> Vec<Command> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let path = e.path().join("SKILL.md");
        let Some(head) = read_head(&path) else { continue };
        let Some(folder) = e.file_name().to_str().map(String::from) else { continue };
        let (front, _) = split_frontmatter(&head);
        let front = front.unwrap_or_default();
        let name = front.get("name").map(|n| n.trim()).filter(|n| valid_name(n)).unwrap_or(&folder);
        if !valid_name(name) {
            continue;
        }
        out.push(Command {
            name: format!("{prefix}{name}"),
            description: clean(front.get("description").cloned()),
            source,
        });
    }
    out
}

/// Calls `found(name, path)` for each `.md` file under `dir`. `name` is the path relative to
/// `root` without `.md`, with `:` between the folders.
fn walk_commands(root: &Path, dir: &Path, depth: usize, found: &mut dyn FnMut(String, &Path)) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        // `metadata` follows symlinks: plugin and user folders are often links.
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if meta.is_dir() {
            walk_commands(root, &path, depth + 1, found);
            continue;
        }
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let Ok(rel) = path.with_extension("").strip_prefix(root).map(Path::to_path_buf) else { continue };
        let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
        let Some(parts) = parts else { continue };
        let name = parts.join(":");
        if valid_name(&name) {
            found(name, &path);
        }
    }
}

/// Skills and commands of each enabled plugin, named `<plugin>:<name>`.
fn plugins(home: &Path) -> Vec<Command> {
    let read_json = |p: PathBuf| -> Option<Value> { serde_json::from_slice(&std::fs::read(p).ok()?).ok() };
    let Some(settings) = read_json(home.join(".claude/settings.json")) else { return Vec::new() };
    let Some(enabled) = settings.get("enabledPlugins").and_then(Value::as_object) else { return Vec::new() };
    let installed = read_json(home.join(".claude/plugins/installed_plugins.json")).unwrap_or(Value::Null);
    // Version 2 keeps the map under `plugins`, version 1 at the top.
    let installed = installed.get("plugins").unwrap_or(&installed);
    let mut out = Vec::new();
    for (key, on) in enabled {
        if on.as_bool() != Some(true) {
            continue;
        }
        let plugin = key.split('@').next().unwrap_or(key);
        if plugin.is_empty() {
            continue;
        }
        let Some(dir) = install_path(installed.get(key)) else { continue };
        out.extend(from_claude_dir(&dir, "plugin", &format!("{plugin}:")));
    }
    out
}

/// `installPath` of an `installed_plugins.json` entry: an object, or a list of objects.
fn install_path(entry: Option<&Value>) -> Option<PathBuf> {
    let entry = entry?;
    let one = |v: &Value| v.get("installPath").and_then(Value::as_str).map(PathBuf::from);
    match entry {
        Value::Array(a) => a.iter().find_map(one),
        v => one(v),
    }
}

/// The first `HEAD_BYTES` of a file as text. `None` when the file cannot be read.
fn read_head(path: &Path) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    f.take(HEAD_BYTES).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Splits `---` frontmatter from the body. Frontmatter with no closing `---` in the text
/// gives no fields and no body.
fn split_frontmatter(text: &str) -> (Option<HashMap<String, String>>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text.strip_prefix("---").filter(|r| r.starts_with('\n') || r.starts_with("\r\n")) else {
        return (None, text);
    };
    let mut fields = HashMap::new();
    let mut offset = 0;
    // The key of a `key: >` or `key: |` value, and its lines so far.
    let mut block: Option<(String, Vec<String>)> = None;
    let end_block = |block: &mut Option<(String, Vec<String>)>, fields: &mut HashMap<String, String>| {
        if let Some((k, lines)) = block.take() {
            fields.insert(k, lines.join(" "));
        }
    };
    for line in rest.split_inclusive('\n') {
        offset += line.len();
        let l = line.trim_end();
        if l == "---" {
            end_block(&mut block, &mut fields);
            return (Some(fields), &rest[offset..]);
        }
        let indented = l.starts_with(' ') || l.starts_with('\t');
        if indented {
            if let Some((_, lines)) = block.as_mut() {
                lines.push(l.trim().to_string());
            }
            // Other indented lines belong to nested values, which are not used.
            continue;
        }
        end_block(&mut block, &mut fields);
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        let Some((k, v)) = l.split_once(':') else { continue };
        let (k, v) = (k.trim(), v.trim());
        if matches!(v, ">" | "|" | ">-" | "|-" | ">+" | "|+" | "") {
            block = Some((k.to_string(), Vec::new()));
        } else {
            fields.insert(k.to_string(), unquote(v).to_string());
        }
    }
    (None, "")
}

fn unquote(v: &str) -> &str {
    for q in ['"', '\''] {
        if let Some(inner) = v.strip_prefix(q).and_then(|s| s.strip_suffix(q)) {
            return inner;
        }
    }
    v
}

/// A name the composer can type: not empty, no space.
fn valid_name(name: &str) -> bool {
    !name.is_empty() && !name.chars().any(char::is_whitespace)
}

/// One line, at most 200 chars; `None` when empty.
fn clean(d: Option<String>) -> Option<String> {
    let d = d?;
    let one: String = d.split_whitespace().collect::<Vec<_>>().join(" ");
    let one: String = one.chars().take(200).collect();
    (!one.is_empty()).then_some(one)
}
