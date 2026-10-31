import type { AgentsInstalled, FsDirs, GitStatus, GitWorktree, RecentSession } from "@herdling/protocol";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { Eye, EyeOff, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, RefreshControl, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { branchError, defaultBranch, worktreeSlug } from "@/changes/worktree";
import { agentLabel } from "@/herdr/agentKinds";
import { canResume, resumeInFolder } from "@/herdr/sessionActions";
import { startSession, workspaceExists } from "@/herdr/startSession";
import { useSnapshots } from "@/herdr/snapshotStore";
import { workspaceForCwd } from "@/herdr/workspaceForCwd";
import { useHostConn, useOnlineHostKey } from "@/hosts/connection";
import { hasMethod, listsMethod } from "@/hosts/methods";
import { useHosts } from "@/hosts/store";
import { AgentPicker } from "@/newSession/AgentPicker";
import { agentFor, rememberAgent, useAgentMemory } from "@/newSession/agentMemory";
import { Autocomplete, type Suggestion } from "@/newSession/autocomplete";
import { DirCache } from "@/newSession/dirCache";
import { FolderBrowser } from "@/newSession/FolderBrowser";
import { fetchInstalled } from "@/newSession/installed";
import { PathField } from "@/newSession/PathField";
import { completeInput, displayPath, resolveInput } from "@/newSession/paths";
import { RecentFolderChips, RecentSessionCards } from "@/newSession/RecentRows";
import { loadRecentSessions, recentFolders } from "@/newSession/recents";
import { RpcError } from "@/rpc/RpcClient";
import { colors, denseScale, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { GlassSurface } from "@/ui/Glass";
import { GoldSwitch } from "@/ui/GoldSwitch";
import * as haptics from "@/ui/haptics";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { confirmDiscard, useDraftGuard } from "@/ui/draftGuard";
import { Text } from "@/ui/Text";
import { MicButton } from "@/voice/MicButton";
import { appendDictation, hostTranscriber } from "@/voice/transcribe";
import { useDictation } from "@/voice/useDictation";

/** Wait this long on a folder before `git.status` runs: browsing passes many folders quickly. */
const GIT_STATUS_DELAY_MS = 300;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => {
        if (!selected) haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : pressed ? colors.raised : "transparent",
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text bold color={selected ? colors.onAccent : colors.text} maxFontSizeMultiplier={denseScale.row}>
        {label}
      </Text>
    </Pressable>
  );
}

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
  const hosts = useHosts((s) => s.hosts);
  const onlineKey = useOnlineHostKey(hosts.map((h) => h.id));
  const online = useMemo(() => hosts.filter((h) => onlineKey.split(",").includes(h.id)), [hosts, onlineKey]);

  const [hostId, setHostId] = useState<string>();
  const remembered = useAgentMemory((s) => s.byHost);
  const kind = agentFor(remembered, hostId);
  const [prompt, setPrompt] = useState("");
  /** Live transcript while the mic is held. */
  const [heard, setHeard] = useState("");
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  // Default to the first online host; drop the choice if that host goes offline.
  useEffect(() => {
    if (!hostId || !online.some((h) => h.id === hostId)) setHostId(online[0]?.id);
  }, [online, hostId]);

  const { rpc, hello } = useHostConn(hostId ?? "");
  const dictation = useDictation({
    onText: (t) => setPrompt((p) => appendDictation(p, t)),
    onPartial: setHeard,
    hostStt:
      rpc && hasMethod(hello, "stt.make")
        ? hostTranscriber((m, p, ms) => rpc.call(m, p, ms), (uri) => new File(uri).base64())
        : undefined,
  });

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

  const pickAgent = (k: string) => hostId && rememberAgent(hostId, k);

  // ---------- recent sessions ----------

  const resumable = canResume(hello, kind);
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
  const allowLeave = useDraftGuard(prompt.trim().length > 0, { lock: busy });
  const start = useCallback(async () => {
    if (!rpc || !hostId || !cwd) return;
    const inWorktree = worktree && repo?.is_repo;
    if (inWorktree && branchError(branch)) return;
    haptics.press();
    setError(undefined);
    let folder = cwd;
    if (inWorktree) {
      setProgress("Creating worktree…");
      try {
        const w = await rpc.call<GitWorktree>("git.worktree_add", { cwd, branch: branch.trim() }, 90_000);
        folder = w.path;
      } catch (e) {
        haptics.fail();
        setError(`Can't create the worktree: ${message(e)}`);
        setProgress(undefined);
        return;
      }
    }
    setProgress("Creating workspace…");
    try {
      // The snapshot can lag: fall back to a new workspace when the old one is gone.
      // A new worktree is a new folder: it always gets a new workspace.
      const reuse = !inWorktree && existing && !newWorkspace && (await workspaceExists(rpc, existing.workspace_id));
      const { paneId, promptError } = await startSession(rpc, {
        cwd: folder,
        kind,
        prompt,
        workspaceId: reuse && existing ? existing.workspace_id : undefined,
        onProgress: setProgress,
      });
      // The agent runs even when the prompt failed: open it with the prompt ready to resend.
      allowLeave();
      router.replace(
        (promptError
          ? { pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId, prompt, promptError } }
          : `/session/${hostId}/${paneId}`) as never,
      );
    } catch (e) {
      haptics.fail();
      setError(message(e));
      setProgress(undefined);
    }
  }, [rpc, hostId, cwd, kind, prompt, existing, newWorkspace, router, allowLeave, worktree, repo, branch]);

  const resume = useCallback(
    async (s: RecentSession) => {
      if (!rpc || !hostId || busy) return;
      // Resuming does not use the typed first prompt: ask before it goes away.
      if (prompt.trim() && !(await confirmDiscard())) return;
      haptics.press();
      setError(undefined);
      setResuming(s.session);
      try {
        const ws = workspaceForCwd(snapshot, s.cwd);
        const reuse = ws && (await workspaceExists(rpc, ws.workspace_id));
        const { paneId } = await resumeInFolder(rpc, { cwd: s.cwd, kind, session: s.session, workspaceId: reuse && ws ? ws.workspace_id : undefined });
        allowLeave();
        router.replace(`/session/${hostId}/${paneId}` as never);
      } catch (e) {
        haptics.fail();
        setError(`Can't resume the session: ${message(e)}`);
        setResuming(undefined);
      }
    },
    [rpc, hostId, busy, prompt, snapshot, kind, allowLeave, router],
  );

  if (online.length === 0)
    return (
      <Screen>
        <Text muted>No host is online. Connect a host first.</Text>
      </Screen>
    );

  const folders = home ? recentFolders(recentCwds, home) : [];
  const label = agentLabel(kind);
  const inWorktree = worktree && repo?.is_repo;
  const where = !cwd || !home ? undefined : inWorktree ? `In a new worktree of ${displayPath(cwd, home)}` : `In ${displayPath(cwd, home)}`;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg }}>
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
          <AgentPicker key={hostId} value={kind} onChange={pickAgent} installed={installed} disabled={busy} />
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
              <Chip label={`New tab in ${existing.label}`} selected={!newWorkspace} onPress={() => setNewWorkspace(false)} />
              <Chip label="New workspace" selected={newWorkspace} onPress={() => setNewWorkspace(true)} />
            </View>
          </Section>
        ) : null}
      </Screen>

      {/* The start bar stays at the bottom: first prompt, dictation and the start button. */}
      <GlassSurface
        style={{
          marginHorizontal: space.sm,
          marginBottom: Math.max(insets.bottom, space.sm),
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
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
          <TextInput
            accessibilityLabel="First prompt (optional)"
            value={prompt}
            onChangeText={setPrompt}
            editable={!busy}
            multiline
            placeholder={heard || `First prompt for ${label} (optional)`}
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
        {heard ? (
          <Text variant="small" muted numberOfLines={2} accessibilityLiveRegion="polite">
            {heard}
          </Text>
        ) : null}
        <Button
          label={progress ?? (resuming ? "Resuming…" : `Start ${label} here`)}
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
    </KeyboardAvoidingView>
  );
}
