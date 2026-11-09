import type { AgentsInstalled, FsDirs, GitStatus, GitWorktree, RecentSession } from "@herdling/protocol";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { Eye, EyeOff, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Alert, Platform, Pressable, RefreshControl, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { branchError, defaultBranch, worktreePane, worktreeSlug } from "@/changes/worktree";
import { agentLabel } from "@/herdr/agentKinds";
import { expectPane } from "@/herdr/expectedPanes";
import { canResume, resumeInFolder } from "@/herdr/sessionActions";
import { startSession, startShell, workspaceExists, type FreshPane } from "@/herdr/startSession";
import { useSnapshots } from "@/herdr/snapshotStore";
import { workspaceForCwd } from "@/herdr/workspaceForCwd";
import { useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { hasMethod, listsMethod } from "@/hosts/methods";
import { useHosts } from "@/hosts/store";
import { AgentPicker } from "@/newSession/AgentPicker";
import { Chip } from "@/newSession/Chip";
import { agentFor, rememberAgent, useAgentMemory } from "@/newSession/agentMemory";
import { Autocomplete, type Suggestion } from "@/newSession/autocomplete";
import { DirCache } from "@/newSession/dirCache";
import { FolderBrowser } from "@/newSession/FolderBrowser";
import { fetchInstalled, SHELL_CHOICE } from "@/newSession/installed";
import { PathField } from "@/newSession/PathField";
import { completeInput, displayPath, resolveInput } from "@/newSession/paths";
import { RecentFolderChips, RecentSessionCards } from "@/newSession/RecentRows";
import { loadRecentSessions, recentFolders } from "@/newSession/recents";
import { startBarAtScreenBottom, startBarBottomMargin } from "@/newSession/startBar";
import { DangerWarning, StartOptionsBar } from "@/newSession/StartOptionsBar";
import { buildArgs } from "@/newSession/startOptions";
import { choiceFor, useStartOptionsMemory } from "@/newSession/startOptionsMemory";
import { RpcError } from "@/rpc/RpcClient";
import { rememberCommand } from "@/terminal/recentCommands";
import { uploadErrorText, uploadPhotos, withPaths } from "@/thread/attachments";
import { PhotoStrip } from "@/thread/PlusMenu";
import { usePasteChips } from "@/thread/usePasteChips";
import { colors, denseScale, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { GlassSurface } from "@/ui/Glass";
import { GoldSwitch } from "@/ui/GoldSwitch";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider, useKeyboardShown } from "@/ui/KeyboardAvoider";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { confirmDiscard, useDraftGuard } from "@/ui/draftGuard";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";
import { appendDictation, hostTranscriber } from "@/voice/transcribe";
import { useDictation } from "@/voice/useDictation";

export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen";

/** Wait this long on a folder before `git.status` runs: browsing passes many folders quickly. */
const GIT_STATUS_DELAY_MS = 300;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Section({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: trailing ? hitTarget : undefined }}>
        <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row}>
          {title}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** "Show hidden" in the FOLDER header: a quiet text toggle. Only on a herdlingd that can list hidden folders. */
function HiddenToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const Icon = value ? Eye : EyeOff;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Show hidden folders"
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptics.tap();
        onChange(!value);
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.sm,
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <Icon size={icon.sm} color={value ? colors.accent : colors.textMuted} strokeWidth={icon.strokeWidth} />
      <Text variant="small" color={value ? colors.accent : colors.textMuted} maxFontSizeMultiplier={denseScale.row}>
        Show hidden
      </Text>
    </Pressable>
  );
}

export default function NewSessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const online = useMemo(() => hosts.filter((h) => onlineKey.split(",").includes(h.id)), [hosts, onlineKey]);

  const [hostId, setHostId] = useState<string>();
  const remembered = useAgentMemory((s) => s.byHost);
  const kind = agentFor(remembered, hostId);
  // Shell is chosen for this screen only: it is not remembered, so the next session starts with the agent again.
  const [shell, setShell] = useState(false);
  const [prompt, setPrompt] = useState("");
  /** The prompt as set last. The paste check compares each change with it (see `usePasteChips`). */
  const latestPrompt = useRef(prompt);
  /** Sets the prompt text. `latestPrompt` changes at once, so code-set text never becomes a chip. */
  const putPrompt = useCallback((next: string | ((cur: string) => string)) => {
    const t = typeof next === "function" ? next(latestPrompt.current) : next;
    latestPrompt.current = t;
    setPrompt(t);
  }, []);
  const promptRef = useRef<ComponentRef<typeof TextInput>>(null);
  /** Live transcript while the mic is held. */
  const [heard, setHeard] = useState("");
  /** A new session gets its own workspace unless the user picks a tab in the workspace of an agent in the same folder. */
  const [newWorkspace, setNewWorkspace] = useState(true);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  // Default to the first online host; drop the choice if that host goes offline.
  useEffect(() => {
    if (!hostId || !online.some((h) => h.id === hostId)) setHostId(online[0]?.id);
  }, [online, hostId]);

  const { rpc, hello } = useHostConn(hostId ?? "");
  const dictation = useDictation({
    onText: (t) => putPrompt((p) => appendDictation(p, t)),
    onPartial: setHeard,
    hostStt:
      rpc && hasMethod(hello, "stt.make")
        ? hostTranscriber((m, p, ms) => rpc.call(m, p, ms), (uri) => new File(uri).base64())
        : undefined,
  });

  /**
   * Long pastes in the first prompt become chips, like in the session composer. On start they go
   * to the computer as `.txt` files, and their paths go at the end of the first prompt. A shell
   * command makes no chips; chips made before the switch to Shell stay hidden and are not sent.
   */
  const pasteChips = usePasteChips({
    enabled: !shell && hasMethod(hello, "files.put"),
    disabled: progress !== undefined,
    putText: putPrompt,
    focus: () => promptRef.current?.focus(),
  });
  const pastes = shell ? [] : pasteChips.pastes;

  // ---------- folders ----------

  const [home, setHome] = useState<string>();
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [listing, setListing] = useState<FsDirs>();
  const [listError, setListError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [pathText, setPathText] = useState("");
  const [pathError, setPathError] = useState<string>();
  const [suggestions, setSuggestions] = useState<{ input: string; items: Suggestion[] }>({ input: "", items: [] });
  const cwd = listing?.path;

  // One cache per host connection: autocomplete and the browser share the listings.
  const cache = useMemo(
    () =>
      rpc
        ? new DirCache((path, hidden) => rpc.call<FsDirs>("fs.dirs", hidden ? { path, hidden, recent: false } : { path, recent: false }))
        : undefined,
    [rpc],
  );
  const complete = useMemo(() => (cache ? new Autocomplete(cache, setSuggestions) : undefined), [cache]);
  useEffect(() => () => complete?.cancel(), [complete]);

  /** Drops the answer of an older navigation when a newer one starts. */
  const navSeq = useRef(0);
  const open = useCallback(
    async (path: string, from: "browse" | "field" = "browse") => {
      if (!cache || !home) return;
      const seq = ++navSeq.current;
      complete?.cancel();
      setSuggestions({ input: "", items: [] });
      setLoading(true);
      try {
        const r = await cache.get(path, showHidden);
        if (seq !== navSeq.current) return;
        setListing(r);
        setPathText(displayPath(r.path, home));
        setPathError(undefined);
        setListError(undefined);
      } catch (e) {
        if (seq !== navSeq.current) return;
        const shown = displayPath(path, home);
        const text = e instanceof RpcError && e.code === "not_found" ? `No folder at ${shown}.` : `Can't open ${shown}: ${message(e)}`;
        if (from === "field") setPathError(text);
        else setListError(text);
      } finally {
        if (seq === navSeq.current) setLoading(false);
      }
    },
    [cache, home, showHidden, complete],
  );

  // A new host starts again at its home folder. A reconnect to the same host keeps the open folder.
  useEffect(() => {
    setHome(undefined);
    setListing(undefined);
    setRecentCwds([]);
    setPathText("");
    setPathError(undefined);
    setListError(undefined);
  }, [hostId]);
  // The first listing: the home folder and the recent folders. An answer for an older
  // connection (another host) is dropped.
  const liveRpc = useRef(rpc);
  useEffect(() => {
    liveRpc.current = rpc;
  }, [rpc]);
  const loadHome = useCallback(async () => {
    if (!rpc) return;
    try {
      const r = await rpc.call<FsDirs>("fs.dirs", {});
      if (liveRpc.current !== rpc) return;
      setHome(r.path);
      setRecentCwds(r.recent_cwds ?? []);
      setListing((l) => l ?? r);
      setPathText((t) => t || displayPath(r.path, r.path));
      setListError(undefined);
    } catch (e) {
      if (liveRpc.current === rpc) setListError(`Can't list folders: ${message(e)}`);
    }
  }, [rpc]);
  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  // "Show hidden" lists the open folder again.
  const shownHidden = useRef(showHidden);
  useEffect(() => {
    if (shownHidden.current === showHidden) return;
    shownHidden.current = showHidden;
    if (cwd) void open(cwd);
  }, [showHidden, cwd, open]);

  const onPathChange = (t: string) => {
    setPathText(t);
    setPathError(undefined);
    if (home && cwd) complete?.update(t, { home, cwd, hidden: showHidden });
  };
  const goToTyped = () => {
    if (!home || !cwd || !pathText.trim()) return;
    void open(resolveInput(pathText, home, cwd), "field");
  };
  // The suggestions belong to the text they were made for: older ones do not show.
  const liveSuggestions = suggestions.input === pathText && pathText !== (cwd && home ? displayPath(cwd, home) : "") ? suggestions.items : [];
  const completed = home && cwd && liveSuggestions.length > 0 ? completeInput(pathText, liveSuggestions.map((s) => s.name)) : undefined;
  const onComplete = completed
    ? () => {
        haptics.tap();
        onPathChange(completed);
      }
    : undefined;

  // ---------- agents ----------

  const [installed, setInstalled] = useState<AgentsInstalled>();
  const loadInstalled = useCallback(async () => {
    setInstalled(rpc ? await fetchInstalled(rpc, hello) : undefined);
  }, [rpc, hello]);
  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  // Start options per agent kind: the pills in the start bar and the options sheet change the remembered ones.
  const storedChoices = useStartOptionsMemory((s) => s.byKind);
  const choice = choiceFor(storedChoices, kind);

  const pickAgent = (k: string) => {
    setShell(k === SHELL_CHOICE);
    if (k !== SHELL_CHOICE && hostId) rememberAgent(hostId, k);
  };

  // ---------- recent sessions ----------

  const resumable = !shell && canResume(hello, kind);
  // Keyed by host and agent: the cards of the last agent go at once, and a refresh keeps the
  // cards until the new answer is in. A refresh reads `recent_cwds` again, which loads them again.
  const sessionsKey = `${hostId}:${kind}`;
  const [loaded, setLoaded] = useState<{ key: string; list: RecentSession[] }>({ key: "", list: [] });
  const sessions = resumable && loaded.key === sessionsKey ? loaded.list : [];
  const [resuming, setResuming] = useState<string>();
  useEffect(() => {
    if (!rpc || !resumable || recentCwds.length === 0) return;
    let live = true;
    loadRecentSessions(rpc, kind, recentCwds).then((list) => live && setLoaded({ key: sessionsKey, list }));
    return () => {
      live = false;
    };
  }, [rpc, resumable, kind, recentCwds, sessionsKey]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    cache?.invalidate();
    await Promise.all([loadHome(), cwd ? open(cwd) : Promise.resolve(), loadInstalled()]);
    setRefreshing(false);
  }, [cache, loadHome, cwd, open, loadInstalled]);

  // ---------- where and git ----------

  const snapshot = useSnapshots((s) => (hostId ? s.byHost[hostId] : undefined));
  const existing = useMemo(() => (cwd ? workspaceForCwd(snapshot, cwd) : undefined), [snapshot, cwd]);
  useEffect(() => setNewWorkspace(false), [cwd]);

  // "In a new git worktree": only for a folder in a git repo, on a herdlingd that can make one.
  const canWorktree = !!rpc && listsMethod(hello, "git.worktree_add") && listsMethod(hello, "git.status");
  const [repo, setRepo] = useState<GitStatus>();
  const [worktree, setWorktree] = useState(false);
  const [branch, setBranch] = useState(() => defaultBranch());
  useEffect(() => {
    setRepo(undefined);
    setWorktree(false);
    if (!rpc || !cwd || !canWorktree) return;
    let dead = false;
    const t = setTimeout(() => {
      rpc
        .call<GitStatus>("git.status", { cwd })
        .then((s) => !dead && setRepo(s))
        // No answer: the option stays hidden.
        .catch(() => {});
    }, GIT_STATUS_DELAY_MS);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [rpc, cwd, canWorktree]);
  const branchProblem = worktree ? branchError(branch) : undefined;

  // ---------- start and resume ----------

  const busy = progress !== undefined || resuming !== undefined;
  // Swiping the sheet away mid-start would leave a half-started session behind (lock). A typed
  // first prompt asks before the modal closes; a started session leaves without asking.
  const allowLeave = useDraftGuard(prompt.trim().length > 0 || pasteChips.pastes.length > 0, { lock: busy });
  const { sent: pastesSent } = pasteChips;
  const start = useCallback(async () => {
    if (!rpc || !hostId || !cwd) return;
    const inWorktree = worktree && repo?.is_repo;
    if (inWorktree && branchError(branch)) return;
    haptics.press();
    setError(undefined);
    // The pasted texts go first, the same way as in the composer: a failed upload starts nothing.
    let firstPrompt = prompt;
    const sentPastes = pastes;
    if (sentPastes.length > 0) {
      setProgress(sentPastes.length > 1 ? `Uploading 1 of ${sentPastes.length}…` : "Uploading pasted text…");
      try {
        const paths = await uploadPhotos(rpc, sentPastes, (done) => {
          if (done < sentPastes.length) setProgress(`Uploading ${done + 1} of ${sentPastes.length}…`);
        });
        firstPrompt = withPaths(prompt, paths);
      } catch (e) {
        haptics.fail();
        setError(`Upload failed, nothing started: ${uploadErrorText(e)}`);
        setProgress(undefined);
        return;
      }
    }
    let folder = cwd;
    let fresh: FreshPane | undefined;
    if (inWorktree) {
      setProgress("Creating worktree…");
      try {
        const w = await rpc.call<GitWorktree>("git.worktree_add", { cwd, branch: branch.trim() }, 90_000);
        folder = w.path;
        fresh = worktreePane(w);
      } catch (e) {
        haptics.fail();
        setError(`Can't create the worktree: ${message(e)}`);
        setProgress(undefined);
        return;
      }
    }
    if (!fresh) setProgress("Creating workspace…");
    try {
      // The snapshot can lag: fall back to a new workspace when the old one is gone.
      // A new worktree is a new folder: it always gets a new workspace. When herdr made the
      // worktree, herdr also made its workspace (`fresh`): the session starts in its pane.
      const reuse = !inWorktree && existing && !newWorkspace && (await workspaceExists(rpc, existing.workspace_id));
      const workspaceId = reuse && existing ? existing.workspace_id : undefined;
      if (shell) {
        const { paneId, commandError } = await startShell(rpc, { cwd: folder, command: prompt, workspaceId, fresh, onProgress: setProgress });
        if (!commandError) rememberCommand(hostId, prompt);
        allowLeave();
        // The mark carries the hint into the detail column of regular width too.
        expectPane(hostId, paneId, "shell");
        router.replace({ pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId, shell: "1" } } as never);
        // The shell runs even when the command did not go through: say so over the open terminal.
        if (commandError) Alert.alert("Command not sent", commandError);
        return;
      }
      // The start options apply to a new agent only: not to a resume and not to a shell.
      const { paneId, promptError } = await startSession(rpc, {
        cwd: folder,
        kind,
        prompt: firstPrompt,
        workspaceId,
        fresh,
        args: buildArgs(kind, choice),
        onProgress: setProgress,
      });
      pastesSent(sentPastes);
      // The agent runs even when the prompt failed: open it with the prompt ready to resend.
      // The uploaded files stay on the computer, so their paths stay in the prompt.
      allowLeave();
      // The snapshot can show the pane before its agent: keep the agent layout, not a terminal.
      expectPane(hostId, paneId, "agent");
      router.replace(
        (promptError
          ? { pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId, prompt: firstPrompt, promptError } }
          : `/session/${hostId}/${paneId}`) as never,
      );
    } catch (e) {
      haptics.fail();
      setError(message(e));
      setProgress(undefined);
    }
  }, [rpc, hostId, cwd, kind, choice, shell, prompt, pastes, pastesSent, existing, newWorkspace, router, allowLeave, worktree, repo, branch]);

  const resume = useCallback(
    async (s: RecentSession) => {
      if (!rpc || !hostId || busy) return;
      // Resuming does not use the typed first prompt: ask before it goes away.
      if ((prompt.trim() || pasteChips.pastes.length > 0) && !(await confirmDiscard())) return;
      haptics.press();
      setError(undefined);
      setResuming(s.session);
      try {
        // Same rule as Start: a new workspace, unless the user picked a tab in an existing one.
        const ws = newWorkspace ? undefined : workspaceForCwd(snapshot, s.cwd);
        const reuse = ws && (await workspaceExists(rpc, ws.workspace_id));
        const { paneId } = await resumeInFolder(rpc, { cwd: s.cwd, kind, session: s.session, workspaceId: reuse && ws ? ws.workspace_id : undefined });
        allowLeave();
        expectPane(hostId, paneId, "agent");
        router.replace(`/session/${hostId}/${paneId}` as never);
      } catch (e) {
        haptics.fail();
        setError(`Can't resume the session: ${message(e)}`);
        setResuming(undefined);
      }
    },
    [rpc, hostId, busy, prompt, pasteChips.pastes.length, snapshot, kind, allowLeave, router, newWorkspace],
  );

  if (online.length === 0)
    return (
      <Screen>
        <Text muted>No host is online. Connect a host first.</Text>
      </Screen>
    );

  const folders = home ? recentFolders(recentCwds, home) : [];
  const label = shell ? "Shell" : agentLabel(kind);
  const inWorktree = worktree && repo?.is_repo;
  const where = !cwd || !home ? undefined : inWorktree ? `In a new worktree of ${displayPath(cwd, home)}` : `In ${displayPath(cwd, home)}`;

  return (
    // Not KeyboardAvoidingView: in the modal sheet, below the native header, it pads too little and
    // the keyboard covers the start bar.
    <KeyboardAvoider atScreenBottom={startBarAtScreenBottom(Platform.OS, Platform.OS === "ios" && Platform.isPad)} style={{ backgroundColor: colors.bg }}>
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.textMuted} />}>
        {online.length > 1 ? (
          <Section title="Host">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {online.map((h) => (
                <Chip key={h.id} label={h.name} selected={h.id === hostId} onPress={() => !busy && setHostId(h.id)} />
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Agent">
          <AgentPicker key={hostId} value={shell ? SHELL_CHOICE : kind} onChange={pickAgent} installed={installed} disabled={busy} />
        </Section>

        {sessions.length > 0 ? (
          <Section title={`Recent ${label} sessions`}>
            <RecentSessionCards sessions={sessions} kind={kind} home={home} resuming={resuming} onResume={(s) => void resume(s)} disabled={busy} />
          </Section>
        ) : null}

        <Section title="Folder" trailing={listing?.hidden !== undefined ? <HiddenToggle value={showHidden} onChange={setShowHidden} /> : null}>
          <PathField
            value={pathText}
            onChangeText={onPathChange}
            onSubmit={goToTyped}
            suggestions={liveSuggestions}
            onPick={(s) => void open(s.path, "field")}
            onComplete={onComplete}
            error={pathError}
            editable={!busy && !!home}
          />
          <RecentFolderChips folders={folders} current={cwd} onOpen={(p) => void open(p)} disabled={busy} />
          <FolderBrowser
            listing={listing}
            home={home}
            loading={loading}
            error={listError}
            onOpen={(p) => void open(p)}
            onRetry={() => (listing && cwd ? void open(cwd) : void loadHome())}
            disabled={busy}
          />
        </Section>

        {cwd && repo?.is_repo ? (
          <Section title="Git">
            <Card style={{ gap: space.sm }}>
              <Row
                title="In a new git worktree"
                detail={repo.branch ? `A new branch from ${repo.branch}, in its own folder` : "A new branch, in its own folder"}
                trailing={<GoldSwitch label="In a new git worktree" value={worktree} onValueChange={(v) => !busy && setWorktree(v)} />}
              />
              {worktree ? (
                <View style={{ gap: space.xs }}>
                  <Text variant="small" muted>
                    Branch name
                  </Text>
                  <TextInput
                    accessibilityLabel="Branch name"
                    value={branch}
                    onChangeText={setBranch}
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    selectionColor={colors.accent}
                    style={{
                      minHeight: hitTarget,
                      paddingHorizontal: space.md,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: branchProblem ? colors.danger : colors.border,
                      backgroundColor: colors.raised,
                      color: colors.text,
                      fontSize: type.size.body,
                    }}
                  />
                  {branchProblem ? (
                    <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                      {branchProblem}
                    </Text>
                  ) : (
                    <Text variant="caption" muted>
                      {`The folder is .worktrees/${worktreeSlug(branch)} in the repo.${
                        repo.files.length > 0 ? " Uncommitted changes stay in the main folder." : ""
                      }`}
                    </Text>
                  )}
                </View>
              ) : null}
            </Card>
          </Section>
        ) : null}

        {cwd && existing && !inWorktree ? (
          <Section title="Where">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              <Chip label="New workspace" selected={newWorkspace} onPress={() => setNewWorkspace(true)} />
              <Chip label={`New tab in ${existing.label}`} selected={!newWorkspace} onPress={() => setNewWorkspace(false)} />
            </View>
          </Section>
        ) : null}
      </Screen>

      {/* The start bar stays at the bottom: first prompt, dictation, the start options and the start button. */}
      <GlassSurface
        style={{
          marginHorizontal: space.sm,
          marginBottom: startBarBottomMargin(insets.bottom, keyboardShown, space.sm),
          padding: space.md,
          gap: space.sm,
          borderRadius: radius.lg,
        }}
      >
        {error ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <TriangleAlert size={icon.sm} color={colors.danger} />
            <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
              {error}
            </Text>
          </View>
        ) : null}
        {pastes.length > 0 ? (
          <PhotoStrip photos={[]} disabled={busy} onRemove={() => {}}>
            {pasteChips.chips}
          </PhotoStrip>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
          <TextInput
            ref={promptRef}
            accessibilityLabel={shell ? "Command (optional)" : "First prompt (optional)"}
            value={prompt}
            onChangeText={(t) => putPrompt(pasteChips.change(latestPrompt.current, t))}
            onSelectionChange={pasteChips.onSelectionChange}
            editable={!busy}
            // A command is one line: no spell check or capitals in the way.
            multiline={!shell}
            autoCapitalize={shell ? "none" : undefined}
            autoCorrect={!shell}
            spellCheck={!shell}
            placeholder={heard || (shell ? "Command (optional)" : `First prompt for ${label} (optional)`)}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={{
              flex: 1,
              minHeight: hitTarget,
              maxHeight: hitTarget * 3,
              paddingHorizontal: space.md,
              paddingTop: space.md,
              paddingBottom: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.raised,
              color: colors.text,
              fontSize: type.size.body,
              textAlignVertical: "top",
            }}
          />
          <MicButton dictation={dictation} disabled={busy} size={hitTarget} />
        </View>
        {pasteChips.viewer}
        {heard ? (
          <Text variant="small" muted numberOfLines={2} accessibilityLiveRegion="polite">
            {heard}
          </Text>
        ) : null}
        {shell ? null : (
          <>
            <StartOptionsBar kind={kind} choice={choice} disabled={busy} />
            <DangerWarning kind={kind} choice={choice} />
          </>
        )}
        <Button
          label={progress ?? (resuming ? "Resuming…" : shell ? "Open shell here" : `Start ${label} here`)}
          loading={busy}
          disabled={!cwd || !!branchProblem}
          onPress={() => void start()}
        />
        {where ? (
          <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="middle" style={{ textAlign: "center" }}>
            {where}
          </Text>
        ) : null}
      </GlassSurface>
    </KeyboardAvoider>
  );
}
