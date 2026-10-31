//! `commands.list`: the commands and skills that Claude Code, Codex, Pi or OpenCode offers in a folder.
//!
//! Claude sources: built-ins, user and project skills and commands, and the skills and
//! commands of enabled plugins. Codex sources: built-ins, custom prompts, and skills from the
//! project, the user and the admin folder. Pi sources: built-ins, skills, prompt templates and
//! the paths in `settings.json`. OpenCode sources: built-ins, command files, the `command`
//! object of the config files, and skills. A missing or unreadable file or folder is skipped.

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
    /// `"$"` for a Codex skill, `"@"` for an OpenCode skill. Missing means `/`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<&'static str>,
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

/// Common Codex built-ins. Codex has more; these are the ones used most.
const CODEX_BUILTINS: &[(&str, &str)] = &[
    ("model", "Choose the model and reasoning effort"),
    ("permissions", "Set what Codex may do without asking"),
    ("review", "Review the working tree changes"),
    ("new", "Start a new conversation"),
    ("resume", "Resume an earlier conversation"),
    ("init", "Write an AGENTS.md for this project"),
    ("compact", "Summarize the conversation to free context"),
    ("diff", "Show the git diff"),
    ("mention", "Attach a file to the conversation"),
    ("status", "Show the session settings and token use"),
    ("mcp", "List the MCP tools"),
    ("skills", "List the available skills"),
    ("quit", "Exit Codex"),
];

/// Pi built-ins. All of them, as the Pi docs list them.
const PI_BUILTINS: &[(&str, &str)] = &[
    ("login", "Log in to a provider"),
    ("logout", "Log out of a provider"),
    ("model", "Choose the model"),
    ("thinking", "Set the thinking level"),
    ("scoped-models", "Choose the models for quick switching"),
    ("settings", "Open the settings"),
    ("resume", "Resume an earlier session"),
    ("new", "Start a new session"),
    ("name", "Set the name of the session"),
    ("session", "Show the session details"),
    ("tree", "Browse the session tree"),
    ("trust", "Save a trust decision for this folder"),
    ("fork", "Fork the session from an earlier message"),
    ("clone", "Copy the current session branch"),
    ("compact", "Summarize the conversation to free context"),
    ("copy", "Copy the last answer"),
    ("export", "Export the session to a file"),
    ("import", "Import a session from a file"),
    ("share", "Share the session"),
    ("reload", "Reload the resources"),
    ("hotkeys", "Show the keyboard shortcuts"),
    ("changelog", "Show the changelog"),
    ("quit", "Exit Pi"),
];

/// OpenCode built-ins.
const OPENCODE_BUILTINS: &[(&str, &str)] = &[
    ("init", "Write an AGENTS.md for this project"),
    ("undo", "Undo the last change"),
    ("redo", "Redo the last undone change"),
    ("help", "Show help"),
    ("compact", "Summarize the conversation to free context"),
    ("connect", "Connect a provider"),
    ("editor", "Write the prompt in the editor"),
    ("exit", "Exit OpenCode"),
    ("models", "Choose the model"),
    ("new", "Start a new session"),
    ("skills", "List the available skills"),
];

/// Agent kinds that `list_for` answers for. Other kinds get the Claude list.
pub const KINDS: &[&str] = &["claude", "codex", "pi", "opencode"];

/// The places that hold the settings and the resources of the agents.
pub struct Roots<'a> {
    pub home: &'a Path,
    /// `CODEX_HOME` when set, else `~/.codex`.
    pub codex_home: Option<&'a Path>,
    /// `/etc/codex/skills`.
    pub admin_skills: &'a Path,
    /// `PI_CODING_AGENT_DIR` when set, else `~/.pi/agent`.
    pub pi_agent_dir: Option<&'a Path>,
    /// `XDG_CONFIG_HOME` when set, else `~/.config`.
    pub xdg_config: Option<&'a Path>,
}

/// The list for an agent `kind`. `codex`, `pi` and `opencode` give their own lists; any other kind
/// gives the Claude list.
pub fn list_for(kind: Option<&str>, roots: &Roots, cwd: Option<&Path>) -> Vec<Command> {
    let home = roots.home;
    match kind {
        Some("codex") => {
            let default = home.join(".codex");
            codex_list(home, roots.codex_home.unwrap_or(&default), roots.admin_skills, cwd)
        }
        Some("pi") => {
            let default = home.join(".pi/agent");
            pi_list(home, roots.pi_agent_dir.unwrap_or(&default), cwd)
        }
        Some("opencode") => {
            let default = home.join(".config");
            opencode_list(home, &roots.xdg_config.unwrap_or(&default).join("opencode"), cwd)
        }
        _ => list(home, cwd),
    }
}

/// All Codex commands for `cwd`, sorted by name. Skills have the `$` trigger.
/// For a skill name: project beats user, user beats admin, and a nearer folder beats a farther one.
/// Prompts are named `prompts:<file>`.
pub fn codex_list(home: &Path, codex_home: &Path, admin_skills: &Path, cwd: Option<&Path>) -> Vec<Command> {
    // A skill and a command can share a name: the trigger is part of the key.
    let mut by_name: HashMap<(bool, String), Command> = HashMap::new();
    // Add from the lowest priority to the highest: a later insert replaces an earlier one.
    let mut add = |found: Vec<Command>| {
        for c in found {
            by_name.insert((c.trigger.is_some(), c.name.clone()), c);
        }
    };
    let dollar = |mut v: Vec<Command>| {
        v.iter_mut().for_each(|c| c.trigger = Some("$"));
        v
    };
    add(CODEX_BUILTINS
        .iter()
        .map(|(n, d)| Command { name: (*n).into(), description: Some((*d).into()), source: "builtin", trigger: None })
        .collect());
    add(codex_prompts(&codex_home.join("prompts")));
    add(dollar(skills(admin_skills, "user", "")));
    add(dollar(skills(&home.join(".agents/skills"), "user", "")));
    if let Some(cwd) = cwd {
        // The folder nearest to `cwd` wins, so add the farthest first.
        for dir in project_dirs(home, cwd).iter().rev() {
            add(dollar(skills(&dir.join(".agents/skills"), "project", "")));
        }
    }
    let mut out: Vec<Command> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.truncate(MAX_COMMANDS);
    out
}

/// The top-level `*.md` files of a Codex prompts folder, named `prompts:<file>`.
fn codex_prompts(dir: &Path) -> Vec<Command> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        // `metadata` follows symlinks.
        let is_file = std::fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false);
        if !is_file || path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()).filter(|s| valid_name(s)) else { continue };
        let Some(head) = read_head(&path) else { continue };
        let (front, _) = split_frontmatter(&head);
        let description = front.and_then(|f| f.get("description").cloned());
        out.push(Command { name: format!("prompts:{stem}"), description: clean(description), source: "user", trigger: None });
    }
    out
}

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
        .map(|(n, d)| Command { name: (*n).into(), description: Some((*d).into()), source: "builtin", trigger: None })
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
    walk_commands(&commands_dir, &commands_dir, 0, ":", &mut |rel, path| {
        let head = read_head(path);
        let (front, body) = head.as_deref().map(split_frontmatter).unwrap_or_default();
        let description = front
            .as_ref()
            .and_then(|f| f.get("description").cloned())
            .or_else(|| body.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from));
        out.push(Command { name: format!("{prefix}{rel}"), description: clean(description), source, trigger: None });
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
            trigger: None,
        });
    }
    out
}

/// Calls `found(name, path)` for each `.md` file under `dir`. `name` is the path relative to
/// `root` without `.md`, with `sep` between the folders. A folder is read in name order.
fn walk_commands(root: &Path, dir: &Path, depth: usize, sep: &str, found: &mut dyn FnMut(String, &Path)) {
    if depth > MAX_DEPTH {
        return;
    }
    for path in sorted_entries(dir) {
        // `metadata` follows symlinks: plugin and user folders are often links.
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if meta.is_dir() {
            walk_commands(root, &path, depth + 1, sep, found);
            continue;
        }
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let Ok(rel) = path.with_extension("").strip_prefix(root).map(Path::to_path_buf) else { continue };
        let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
        let Some(parts) = parts else { continue };
        let name = parts.join(sep);
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

/// The paths in a folder, sorted by name. Empty when the folder cannot be read.
fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    paths
}

/// Merges lists given from the highest priority to the lowest. For one trigger and name, the first
/// one found stays. The result is sorted by name.
fn merge_first(lists: Vec<Vec<Command>>) -> Vec<Command> {
    let mut by_name: HashMap<(Option<&'static str>, String), Command> = HashMap::new();
    for c in lists.into_iter().flatten() {
        by_name.entry((c.trigger, c.name.clone())).or_insert(c);
    }
    let mut out: Vec<Command> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.trigger.cmp(&b.trigger)));
    out.truncate(MAX_COMMANDS);
    out
}

fn builtin_commands(list: &[(&str, &str)]) -> Vec<Command> {
    list.iter()
        .map(|(n, d)| Command { name: (*n).into(), description: Some((*d).into()), source: "builtin", trigger: None })
        .collect()
}

fn with_trigger(mut v: Vec<Command>, trigger: &'static str) -> Vec<Command> {
    v.iter_mut().for_each(|c| c.trigger = Some(trigger));
    v
}

/// True when `path` is a file or a link to a file.
fn is_file(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

fn is_dir(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

/// All Pi commands for `cwd`, sorted by name. Order of priority, highest first: the project
/// (`.pi` in `cwd`, then `.agents/skills` from `cwd` up to the git root), then the user
/// (`agent_dir`, then `~/.agents/skills`). When two items have the same name, the first found stays.
/// A custom prompt replaces a built-in of the same name. Skills are named `skill:<name>`.
pub fn pi_list(home: &Path, agent_dir: &Path, cwd: Option<&Path>) -> Vec<Command> {
    let mut lists = Vec::new();
    if let Some(cwd) = cwd.filter(|c| *c != home) {
        let pi = cwd.join(".pi");
        lists.push(pi_skills(&pi.join("skills"), true, "project"));
        lists.push(pi_prompts(&pi.join("prompts"), "project"));
        lists.extend(pi_settings(&pi.join("settings.json"), &pi, home, "project"));
        for dir in project_dirs(home, cwd) {
            lists.push(pi_skills(&dir.join(".agents/skills"), false, "project"));
        }
    }
    lists.push(pi_skills(&agent_dir.join("skills"), true, "user"));
    lists.push(pi_prompts(&agent_dir.join("prompts"), "user"));
    lists.extend(pi_settings(&agent_dir.join("settings.json"), agent_dir, home, "user"));
    lists.push(pi_skills(&home.join(".agents/skills"), false, "user"));
    lists.push(builtin_commands(PI_BUILTINS));
    merge_first(lists)
}

/// Skills under a Pi skills folder, named `skill:<name>`. A folder with `SKILL.md` is a skill and is
/// not searched further; other folders are searched. With `root_md`, a `*.md` file in the folder
/// itself is a skill too. A skill with no `description` is not loaded.
fn pi_skills(dir: &Path, root_md: bool, source: &'static str) -> Vec<Command> {
    let mut out = Vec::new();
    pi_skill_walk(dir, 0, root_md, source, &mut out);
    out
}

fn pi_skill_walk(dir: &Path, depth: usize, root_md: bool, source: &'static str, out: &mut Vec<Command>) {
    if depth > MAX_DEPTH {
        return;
    }
    for path in sorted_entries(dir) {
        if is_dir(&path) {
            let skill_file = path.join("SKILL.md");
            if is_file(&skill_file) {
                let folder = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                out.extend(pi_skill_file(&skill_file, folder, source));
            } else {
                pi_skill_walk(&path, depth + 1, false, source, out);
            }
        } else if depth == 0 && root_md && path.extension().and_then(|x| x.to_str()) == Some("md") && is_file(&path) {
            let stem = path.file_stem().and_then(|n| n.to_str()).unwrap_or("");
            out.extend(pi_skill_file(&path, stem, source));
        }
    }
}

/// One skill file. The name comes from the frontmatter, else `fallback`.
fn pi_skill_file(path: &Path, fallback: &str, source: &'static str) -> Option<Command> {
    let head = read_head(path)?;
    let front = split_frontmatter(&head).0.unwrap_or_default();
    let description = clean(front.get("description").cloned())?;
    let name = front.get("name").map(|n| n.trim()).filter(|n| valid_name(n)).unwrap_or(fallback);
    valid_name(name).then(|| Command { name: format!("skill:{name}"), description: Some(description), source, trigger: None })
}

/// The top-level `*.md` files of a prompts folder, named by the file. The description is optional.
fn pi_prompts(dir: &Path, source: &'static str) -> Vec<Command> {
    sorted_entries(dir).iter().filter_map(|p| pi_prompt_file(p, source)).collect()
}

fn pi_prompt_file(path: &Path, source: &'static str) -> Option<Command> {
    if !is_file(path) || path.extension().and_then(|x| x.to_str()) != Some("md") {
        return None;
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).filter(|s| valid_name(s))?;
    let head = read_head(path)?;
    let (front, body) = split_frontmatter(&head);
    let description = front
        .and_then(|f| f.get("description").cloned())
        .or_else(|| body.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from));
    Some(Command { name: stem.to_string(), description: clean(description), source, trigger: None })
}

/// The skills and the prompts that the `skills` and `prompts` arrays of a Pi `settings.json` name.
/// A relative path starts at `base`. An entry with a glob or a `!`, `+` or `-` prefix is not used.
fn pi_settings(file: &Path, base: &Path, home: &Path, source: &'static str) -> Vec<Vec<Command>> {
    let Some(settings) = read_json_file(file) else { return Vec::new() };
    let paths = |key: &str| -> Vec<PathBuf> {
        let Some(list) = settings.get(key).and_then(Value::as_array) else { return Vec::new() };
        list.iter()
            .filter_map(Value::as_str)
            .filter(|e| !e.is_empty() && !e.starts_with(['!', '+', '-']) && !e.contains(['*', '?', '[', '{']))
            .map(|e| match e.strip_prefix("~/") {
                Some(rest) => home.join(rest),
                None if e == "~" => home.to_path_buf(),
                None => base.join(e),
            })
            .collect()
    };
    let mut out = Vec::new();
    for p in paths("skills") {
        if is_dir(&p) {
            out.push(pi_skills(&p, true, source));
        } else if is_file(&p) {
            let is_skill_md = p.file_name().and_then(|n| n.to_str()) == Some("SKILL.md");
            let fallback = if is_skill_md {
                p.parent().and_then(|o| o.file_name())
            } else {
                p.file_stem()
            };
            let fallback = fallback.and_then(|n| n.to_str()).unwrap_or("");
            out.push(pi_skill_file(&p, fallback, source).into_iter().collect());
        }
    }
    for p in paths("prompts") {
        if is_dir(&p) {
            out.push(pi_prompts(&p, source));
        } else {
            out.push(pi_prompt_file(&p, source).into_iter().collect());
        }
    }
    out
}

/// All OpenCode commands for `cwd`, sorted by name. `config_dir` is `~/.config/opencode`.
/// Priority, highest first: each folder from `cwd` up to the git root (its `.opencode` folder, then its
/// `opencode.json` and `opencode.jsonc`), then `config_dir`, then the built-ins. When two items
/// have the same name, the first found stays; a custom command replaces a built-in.
/// Commands start with `/`. Skills start with `@`.
pub fn opencode_list(home: &Path, config_dir: &Path, cwd: Option<&Path>) -> Vec<Command> {
    let mut lists = Vec::new();
    let projects = cwd.map(|c| project_dirs(home, c)).unwrap_or_default();
    for dir in &projects {
        lists.push(opencode_dir(&dir.join(".opencode"), "project"));
        lists.extend(opencode_configs(dir, "project"));
    }
    lists.push(opencode_dir(config_dir, "user"));
    lists.extend(opencode_configs(config_dir, "user"));
    lists.push(builtin_commands(OPENCODE_BUILTINS));
    // Skills: the project folders first, then the user folders. The `@` trigger keeps them apart from commands.
    for dir in &projects {
        for sub in [".opencode", ".claude", ".agents"] {
            lists.push(with_trigger(skills(&dir.join(sub).join("skills"), "project", ""), "@"));
        }
    }
    for base in [config_dir.to_path_buf(), home.join(".claude"), home.join(".agents")] {
        lists.push(with_trigger(skills(&base.join("skills"), "user", ""), "@"));
    }
    merge_first(lists)
}

/// The command files under `<dir>/command` and `<dir>/commands`, named by the path without `.md`
/// (`/` between folders). The description comes from the frontmatter only.
fn opencode_dir(dir: &Path, source: &'static str) -> Vec<Command> {
    let mut out = Vec::new();
    for sub in ["command", "commands"] {
        let root = dir.join(sub);
        walk_commands(&root, &root, 0, "/", &mut |name, path| {
            let head = read_head(path);
            let front = head.as_deref().map(split_frontmatter).and_then(|f| f.0).unwrap_or_default();
            out.push(Command { name, description: clean(front.get("description").cloned()), source, trigger: None });
        });
    }
    out
}

/// The `command` object of `opencode.json` and `opencode.jsonc` in `dir`. A file that does not parse is skipped.
fn opencode_configs(dir: &Path, source: &'static str) -> Vec<Vec<Command>> {
    ["opencode.json", "opencode.jsonc"]
        .iter()
        .filter_map(|f| {
            let value = read_json_file(&dir.join(f))?;
            let map = value.get("command")?.as_object()?;
            Some(
                map.iter()
                    .filter(|(k, _)| valid_name(k))
                    .map(|(k, v)| Command {
                        name: k.clone(),
                        description: clean(v.get("description").and_then(Value::as_str).map(String::from)),
                        source,
                        trigger: None,
                    })
                    .collect(),
            )
        })
        .collect()
}

/// A JSON file that can have comments and trailing commas. `None` when it is missing or does not parse.
fn read_json_file(path: &Path) -> Option<Value> {
    serde_json::from_str(&strip_jsonc(&std::fs::read_to_string(path).ok()?)).ok()
}

/// Turns JSONC into JSON: removes `//` and `/* */` comments and trailing commas. Text inside
/// strings stays as it is.
fn strip_jsonc(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => out.extend(chars.next()),
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                while chars.peek().is_some_and(|n| *n != '\n') {
                    chars.next();
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut prev = '\0';
                for n in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
                // A comment separates tokens.
                out.push(' ');
            }
            '}' | ']' => {
                let kept = out.trim_end().len();
                if out[..kept].ends_with(',') {
                    out.remove(kept - 1);
                }
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}
