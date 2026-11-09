/**
 * One session: the chat (Thread) or the terminal, the composer, search and the session actions.
 * A pane with no agent (a terminal, such as a plain shell) shows only the terminal.
 * The session route shows it full screen, with `SessionHeader` in the native header. The detail
 * column of Overview (regular width) shows it with `SessionHeader` as a plain row on top.
 */
import type { PortInfo } from "@herdling/protocol";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { Ellipsis, Search, Square, TriangleAlert, Volume2, VolumeX } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useSessionBackground } from "@/board/useSessionBackground";
import { getHostConn, useHostConn } from "@/hosts/connection";
import { listsMethod } from "@/hosts/methods";
import { useHosts } from "@/hosts/store";
import { agentKind, agentTitle } from "@/herdr/names";
import { neighborAgents } from "@/herdr/neighbors";
import { markSeen } from "@/herdr/seen";
import { chooseRestart, confirmDestructive, restartConfirmed, sessionToKeep } from "@/herdr/confirmActions";
import { rememberedArgs } from "@/newSession/startOptionsMemory";
import { useExpectedPane } from "@/herdr/expectedPanes";
import { EXPLAIN_LABEL, EXPLAIN_METHOD } from "@/herdr/explain";
import { closeWithGroupIntent } from "@/herdr/groupClose";
import { renameItems } from "@/herdr/rename";
import { canResume, closeAgent } from "@/herdr/sessionActions";
import type { AgentInfo } from "@/herdr/snapshot";
import { useSnapshots } from "@/herdr/snapshotStore";
import { herdrSupports } from "@/herdr/support";
import { statusLabel, useTerminalStatus } from "@/herdr/terminalStatus";
import { showsTerminal, terminalFolder, terminalPane, terminalTitle } from "@/herdr/terminals";
import { useTerminalStatusPolling } from "@/herdr/useTerminalStatusPolling";
import { portLabel } from "@/preview/preview";
import { usePorts, usePreviewSupported } from "@/preview/usePreview";
import { sendKey } from "@/terminal/keys";
import { NOTIFY_LABEL, STOP_NOTIFY_LABEL, useShellWatch } from "@/terminal/shellWatch";
import { colors, denseScale, dot, hitTarget, icon, space } from "@/theme/tokens";
import { Composer } from "@/thread/Composer";
import { SwipePanContext } from "@/thread/HScrollView";
import { TerminalView } from "@/thread/TerminalView";
import { PendingBubbles } from "@/thread/items/PendingBubble";
import { usePendingList } from "@/thread/pending";
import { ThreadList } from "@/thread/ThreadList";
import { ThreadSkeleton } from "@/thread/ThreadSkeleton";
import { ThreadLogContext } from "@/thread/ThreadLogContext";
import { subagentList } from "@/thread/subagentState";
import { useThread, type Thread } from "@/thread/useThread";
import { countLabel, SEARCH_DEBOUNCE_MS, step } from "@/thread/search";
import { SearchBar } from "@/thread/SearchBar";
import { SearchMarksContext } from "@/thread/searchMarks";
import { useDebounced, useThreadSearch } from "@/thread/useThreadSearch";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider, useKeyboardShown } from "@/ui/KeyboardAvoider";
import { useKeyCommand } from "@/ui/keyCommands";
import { showActionSheet } from "@/ui/nativeSheet";
import { Segmented } from "@/ui/Segmented";
import { type BadgeStatus } from "@/ui/StatusIcon";
import { isStatusShown, StatusRow } from "@/ui/StatusRow";
import { AgentMark } from "@/ui/AgentMark";
import { TerminalMark } from "@/ui/TerminalMark";
import { Text } from "@/ui/Text";
import { sessionKey, useSessionSpeak, useSpeakEnabled } from "@/voice/settings";
import { stopSpeaking, useSpeakReplies, useSpeaking } from "@/voice/useSpeakReplies";
import { useVoiceNotice } from "@/voice/voiceNotice";
import { DelayedSpinner } from "@/ui/Delayed";

type Mode = "thread" | "terminal";

const MODES = [
  { id: "thread", label: "Thread" },
  { id: "terminal", label: "Terminal" },
] as const satisfies readonly { id: Mode; label: string }[];

/** A bar button in the header: 44 pt, the icon centered. */
const HEADER_BUTTON = { width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" } as const;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The listening ports of the computer as a sheet. A pick opens the browser preview. */
function showPortSheet(hostId: string, paneId: string, ports: PortInfo[], open: (port: number) => void) {
  if (ports.length === 0) {
    Alert.alert("No dev server found", "No process of your user listens on a loopback port of this computer. Start a dev server, then try again.");
    return;
  }
  showActionSheet(
    { title: "Preview", message: "Open a port of this computer", options: [...ports.map((p) => portLabel(p, paneId)), "Cancel"], cancelButtonIndex: ports.length },
    (i) => {
      const p = ports[i];
      if (p) open(p.port);
    },
  );
}

/**
 * Restart, Resume (agents with a resume flag), Changes, Preview, "Why this status?" (a herdr with
 * `agent.explain`), the three renames and Close for the session's agent. A terminal (`terminal` true, no agent) gets "Notify me when it finishes"
 * (a host that lists `shell.watch`), Changes, Preview and Close.
 * `openPane` shows another pane in place of this one (after a restart). `closed` runs after Close.
 * `ports` is undefined when the preview does not show for this host.
 */
function useSessionMenu(
  hostId: string,
  paneId: string,
  agent: AgentInfo | undefined,
  terminal: boolean,
  openPane: (paneId: string) => void,
  closed: () => void,
  ports?: PortInfo[],
) {
  const router = useRouter();
  const { rpc, hello } = useHostConn(hostId);
  const [busy, setBusy] = useState<string>();
  const shellWatch = useShellWatch(rpc, hello, paneId, terminal && !agent);

  const run = useCallback(
    async (label: string, failTitle: string, action: () => Promise<void>) => {
      setBusy(label);
      try {
        await action();
      } catch (e) {
        Alert.alert(failTitle, message(e));
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );

  const open = useCallback(() => {
    if (!rpc || !(agent || terminal) || busy) return;
    const items: { label: string; destructive?: boolean; onPick: () => void }[] = [];
    if (shellWatch.supported) {
      items.push({
        label: shellWatch.watched ? STOP_NOTIFY_LABEL : NOTIFY_LABEL,
        onPick: () => run("Saving…", "Can't change the notification", shellWatch.toggle),
      });
      // herdlingd removes the watch after the push: ask again for the next time the menu opens.
      shellWatch.refresh();
    }
    if (agent) {
      items.push({
        label: "Restart",
        destructive: true,
        onPick: async () => {
          const session = await sessionToKeep(rpc, hello, agent);
          const choice = await chooseRestart(!!session);
          if (choice === "options") router.push(`/restart/${hostId}/${paneId}?replace=1` as never);
          else if (choice)
            run("Restarting…", "Can't restart", () =>
              restartConfirmed(rpc, hostId, agent, openPane, {
                session: choice === "keep" ? session : undefined,
                args: rememberedArgs(agent.agent),
              }),
            );
        },
      });
    }
    if (agent?.agent && canResume(hello, agent.agent)) {
      items.push({
        label: "Resume older session",
        onPick: () => router.push(`/resume/${hostId}/${paneId}` as never),
      });
    }
    if (listsMethod(hello, "git.status")) {
      items.push({ label: "Changes", onPick: () => router.push(`/changes/${hostId}/${paneId}` as never) });
    }
    if (ports) {
      items.push({
        label: ports.length > 0 ? `Preview (${ports.length})` : "Preview",
        // After the menu closes, so the two sheets do not overlap.
        onPick: () =>
          setTimeout(() => showPortSheet(hostId, paneId, ports, (port) => router.push(`/preview/${hostId}/${port}` as never)), 0),
      });
    }
    // herdr 0.9 explains its status detection. Hidden after the host refused the method once.
    if (agent && herdrSupports(hostId, EXPLAIN_METHOD)) {
      items.push({ label: EXPLAIN_LABEL, onPick: () => router.push(`/explain/${hostId}/${paneId}` as never) });
    }
    if (agent) items.push(...renameItems(rpc, hostId, agent));
    const [what, detail] = agent
      ? ["Close this agent?", "The agent stops and its pane closes."]
      : ["Close this terminal?", "The shell and the programs in it stop, and the pane closes."];
    items.push({
      label: "Close",
      destructive: true,
      onPick: async () => {
        const ok = await confirmDestructive(what, detail, "Close");
        if (!ok) return;
        // The last pane of a workspace with worktrees: herdr asks for group intent (`closeWithGroupIntent`).
        const workspaceId = agent?.workspace_id ?? useSnapshots.getState().byHost[hostId]?.panes.find((p) => p.pane_id === paneId)?.workspace_id;
        run("Closing…", "Can't close", async () => {
          if (await closeWithGroupIntent(rpc, workspaceId, () => closeAgent(rpc, paneId))) closed();
        });
      },
    });
    const options = [...items.map((i) => i.label), "Cancel"];
    showActionSheet(
      {
        options,
        cancelButtonIndex: items.length,
        destructiveButtonIndex: items.flatMap((it, i) => (it.destructive ? [i] : [])),
      },
      (i) => items[i]?.onPick(),
    );
  }, [rpc, hello, agent, terminal, busy, run, router, hostId, paneId, openPane, closed, ports, shellWatch]);

  return { open, busy, enabled: !!rpc && (!!agent || terminal) && !busy, ports };
}

const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 600;
const SWIPE_FOLLOW = 0.3;

/**
 * Swipe left for the next agent of the workspace, right for the previous one. Wraps the thread only:
 * the composer (mic hold) and the terminal sit outside. Horizontal intent only, so vertical scroll is untouched.
 * Horizontal scroll views inside block the pan (see `HScrollView`). This is more robust than an
 * edge-only swipe: the left edge belongs to the iOS back gesture, and the relation is explicit,
 * not a race between the pan and the native scroll view.
 */
function SwipeBetweenAgents({
  hostId,
  paneId,
  openPane,
  children,
}: {
  hostId: string;
  paneId: string;
  openPane: (paneId: string) => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const { prev, next } = useMemo(() => (snapshot ? neighborAgents(snapshot, paneId) : {}), [snapshot, paneId]);
  const x = useSharedValue(0);

  const go = useCallback(
    (target: string) => {
      haptics.tap();
      openPane(target);
    },
    [openPane],
  );

  const gesture = usePanGesture({
    activeOffsetX: [-30, 30],
    failOffsetY: [-15, 15],
    onUpdate: (e) => {
      // Rubber-band toward a side with no neighbor; no translation at all under Reduce Motion.
      if (reduced) return;
      const open = e.translationX < 0 ? next : prev;
      x.set(e.translationX * (open ? SWIPE_FOLLOW : SWIPE_FOLLOW / 3));
    },
    onDeactivate: (e) => {
      const far = Math.abs(e.translationX) > SWIPE_DISTANCE || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      const target = e.translationX < 0 ? next : prev;
      x.set(reduced ? 0 : withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: e.velocityX }));
      if (!e.canceled && far && target) scheduleOnRN(go, target);
    },
  });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    // Horizontal scroll views inside (code blocks, tool output, the terminal fallback) block this pan.
    <SwipePanContext.Provider value={gesture}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
      </GestureDetector>
    </SwipePanContext.Provider>
  );
}

function ThreadBody({
  thread,
  hostId,
  paneId,
  focused,
  badge,
  background,
  focusId,
}: {
  thread: Thread;
  hostId: string;
  paneId: string;
  focused: boolean;
  badge: BadgeStatus;
  /** Background work of an idle agent ("1 shell running"), shown in the status row. */
  background?: string;
  /** Search: the item to scroll into view. */
  focusId?: string;
}) {
  const { status, items } = thread;
  const pending = usePendingList(hostId, paneId);
  const subagents = useMemo(() => subagentList(items), [items]);
  if (status === "no_session") {
    return (
      <View style={{ flex: 1 }}>
        <Text variant="caption" muted style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          No conversation log for this agent. Showing its terminal.
        </Text>
        <TerminalView hostId={hostId} paneId={paneId} active={focused} />
        <StatusRow status={badge} background={background} />
      </View>
    );
  }
  // First load: the shape of a thread, not a spinner.
  if (items.length === 0 && pending.length === 0 && status === "loading") return <ThreadSkeleton />;
  if (items.length === 0 && pending.length === 0) {
    const note =
      status === "loading"
        ? null
        : status === "waiting"
          ? "No messages yet. Send the first prompt."
          : status === "offline"
            ? "Host offline."
            : status === "error"
              ? `Can't load the thread: ${thread.error ?? "unknown error"}. Retrying…`
              : "No messages yet.";
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
        {note ? (
          <Text muted style={{ textAlign: "center" }}>
            {note}
          </Text>
        ) : null}
        <StatusRow status={badge} background={background} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {status === "error" ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.xs, backgroundColor: colors.card }}
        >
          <TriangleAlert size={12} color={colors.status.blocked} />
          <Text variant="caption" color={colors.status.blocked} numberOfLines={1} style={{ flex: 1 }}>
            {`Live updates paused: ${thread.error ?? "unknown error"}. Retrying…`}
          </Text>
        </View>
      ) : null}
      <ThreadLogContext.Provider value={thread.ref?.log_path ? { hostId, logPath: thread.ref.log_path, paneId } : null}>
        <ThreadList
          items={items}
          loadOlder={thread.loadOlder}
          loadingOlder={thread.loadingOlder}
          hasOlder={thread.hasOlder}
          tail={<PendingBubbles hostId={hostId} paneId={paneId} />}
          // One pill for the agent and its running subagents.
          footer={<StatusRow status={badge} background={background} subagents={subagents} />}
          footerShown={isStatusShown(badge, background, subagents.running.length)}
          live={{ hostId, paneId, active: focused }}
          focusId={focusId}
        />
      </ThreadLogContext.Provider>
    </View>
  );
}

type Menu = ReturnType<typeof useSessionMenu>;

/** The agent (or terminal) mark, then the title (long press for the menu) and "host · agent" or the busy text of the menu. */
function SessionTitle({
  kind,
  terminal,
  title,
  subtitle,
  menu,
  inline,
}: {
  kind: string | undefined;
  terminal: boolean;
  title: string;
  subtitle: string;
  menu: Menu;
  inline: boolean;
}) {
  return (
    <Pressable
      onLongPress={menu.open}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Long press for session actions"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: hitTarget,
        ...(inline ? { flex: 1 } : { maxWidth: 240 }),
      }}
    >
      {terminal ? <TerminalMark size={28} /> : kind ? <AgentMark kind={kind} size={28} /> : null}
      <View style={{ flexShrink: 1, justifyContent: "center", alignItems: inline ? "flex-start" : "center" }}>
        <Text bold numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          {title}
        </Text>
        <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          {menu.busy ?? subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/** The speaker switch (or "Stop reading" while speech plays) and the session actions button. A terminal has no replies to speak. */
function SessionActions({ hostId, paneId, menu, terminal }: { hostId: string; paneId: string; menu: Menu; terminal: boolean }) {
  const speakOn = useSpeakEnabled(hostId, paneId);
  const setSpeak = useSessionSpeak((s) => s.setSpeak);
  const speaking = useSpeaking((s) => s.speaking);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {/* While speech plays, the speaker button stops it. The speaker setting stays as it is. */}
      {terminal ? null : speaking ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop reading"
          onPress={() => {
            haptics.tap();
            stopSpeaking();
          }}
          style={HEADER_BUTTON}
        >
          <Square size={icon.sm + 2} color={colors.accent} fill={colors.accent} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Speak replies"
          accessibilityState={{ checked: speakOn }}
          onPress={() => {
            haptics.tap();
            setSpeak(sessionKey(hostId, paneId), !speakOn);
          }}
          style={HEADER_BUTTON}
        >
          {speakOn ? <Volume2 size={icon.md} color={colors.accent} /> : <VolumeX size={icon.md} color={colors.textMuted} />}
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={menu.ports?.length ? "Session actions, dev server found" : "Session actions"}
        accessibilityState={{ disabled: !menu.enabled, busy: !!menu.busy }}
        disabled={!menu.enabled}
        onPress={menu.open}
        style={HEADER_BUTTON}
      >
        {menu.busy ? <DelayedSpinner color={colors.textMuted} /> : <Ellipsis size={icon.md} color={menu.enabled ? colors.text : colors.textMuted} />}
        {/* The badge: the computer has a listening dev port that "Preview" can open. */}
        {menu.ports && menu.ports.length > 0 && !menu.busy ? (
          <View
            importantForAccessibility="no"
            style={{ position: "absolute", top: space.sm, right: space.sm, width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: colors.text }}
          />
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * The session header. `native`: the title view and the bar buttons of the route's native header
 * (iOS 26 draws them on Liquid Glass). `inline`: the same parts as a plain row, for the detail column.
 */
export function SessionHeader({
  placement,
  hostId,
  paneId,
  kind,
  terminal = false,
  title,
  subtitle,
  menu,
}: {
  placement: "native" | "inline";
  hostId: string;
  paneId: string;
  /** The agent kind, for the mark before the title. Unknown: no mark. */
  kind: string | undefined;
  /** A pane with no agent: the terminal mark, and no speaker switch. */
  terminal?: boolean;
  title: string;
  subtitle: string;
  menu: Menu;
}) {
  if (placement === "native") {
    return (
      <Stack.Screen
        options={{
          headerTitle: () => <SessionTitle kind={kind} terminal={terminal} title={title} subtitle={subtitle} menu={menu} inline={false} />,
          headerRight: () => <SessionActions hostId={hostId} paneId={paneId} menu={menu} terminal={terminal} />,
        }}
      />
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.xs }}>
      <SessionTitle kind={kind} terminal={terminal} title={title} subtitle={subtitle} menu={menu} inline />
      <SessionActions hostId={hostId} paneId={paneId} menu={menu} terminal={terminal} />
    </View>
  );
}

export type SessionDetailProps = {
  hostId: string;
  paneId: string;
  /** Set by New session when the first prompt failed after the agent started. */
  prompt?: string;
  promptError?: string;
  /** "push" when a notification opened the session. */
  from?: string;
  /**
   * New session opened a plain shell here. Until the snapshot shows the pane, the screen treats it
   * as a terminal. Afterwards the snapshot decides: an agent in the pane gets the Thread again.
   */
  shell?: boolean;
  /**
   * False when this session must not poll, speak or take shortcuts, although its screen has the
   * focus. The route passes true. The detail column passes true for the selected pane only.
   */
  active: boolean;
  /** Where the header goes: the route's native header, or a plain row on top. */
  header: "native" | "inline";
  /** Shows another pane of the same host in place of this one (swipe, ⌘[ ⌘], restart). */
  onOpenPane: (paneId: string) => void;
  /** Runs after Close stopped the agent or closed the terminal. */
  onClosed: () => void;
  /** ⌘[ and ⌘] go to the previous or next agent of the workspace. The detail column moves on the board instead. */
  neighborShortcuts?: boolean;
};

export function SessionDetail({
  hostId,
  paneId,
  prompt,
  promptError,
  from,
  shell = false,
  active,
  header,
  onOpenPane,
  onClosed,
  neighborShortcuts = false,
}: SessionDetailProps) {
  // Only the focused session speaks and polls choices: another session or a modal may sit on top.
  const screenFocused = useIsFocused();
  const focused = screenFocused && active;
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const [mode, setMode] = useState<Mode>("thread");
  const conn = useHostConn(hostId);
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const thread = useThread(hostId, paneId, agent?.agent_status);

  useSpeakReplies(hostId, paneId, agent?.agent_status, thread.items, { speakNow: from === "push", focused });
  const voiceNotice = useVoiceNotice((s) => s.text);

  // Opening the session, and every status change seen here, counts as seen.
  const seq = agent?.state_change_seq;
  useEffect(() => {
    if (seq !== undefined) markSeen(hostId, paneId, seq);
  }, [hostId, paneId, seq]);

  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  // What the app just started here: an agent keeps this layout while the snapshot lags, a new
  // shell is a terminal at once. The mark goes away when the snapshot shows the agent or the pane.
  const mark = useExpectedPane(hostId, paneId, (kind) =>
    kind === "agent" ? !!agent : !!snapshot?.panes.some((p) => p.pane_id === paneId),
  );
  const expected = shell ? "shell" : mark;
  // A terminal: a pane with no agent, or the new shell that the snapshot does not show yet.
  const terminal = showsTerminal(snapshot, paneId, expected);
  const termPane = terminal ? terminalPane(snapshot, paneId) : undefined;
  const view: Mode = terminal ? "terminal" : mode;
  const folder = termPane ? terminalFolder(termPane) : undefined;
  // A terminal shows "Idle" or "Running: <command>" under its title. Agent panes are never polled.
  useTerminalStatusPolling(hostId, termPane ? [paneId] : [], focused && !!termPane);
  const termStatus = useTerminalStatus((s) => (termPane ? s.byKey[`${hostId}:${paneId}`] : undefined));
  const title = terminal
    ? termPane
      ? terminalTitle(termPane)
      : "Terminal"
    : agent && snapshot
      ? agentTitle(snapshot, agent)
      : thread.ref?.kind || paneId;
  const kind = terminal ? undefined : agent ? agentKind(agent) : thread.ref?.kind;
  const badge: BadgeStatus = conn.status !== "online" ? "offline" : (agent?.agent_status ?? "unknown");
  const background = useSessionBackground(hostId, paneId, agent?.agent_status, focused && conn.status === "online");
  // Browser preview: only on a build and a herdlingd that have it. The port list loads while the session is in view.
  const previewOn = usePreviewSupported(hostId);
  const livePorts = usePorts(hostId, paneId, previewOn && focused);
  const ports = previewOn ? (livePorts ?? []) : undefined;
  const menu = useSessionMenu(hostId, paneId, agent, terminal, onOpenPane, onClosed, ports);

  // Search: in the thread items (Thread) or in the visible terminal text (Terminal).
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const threadSearch = useThreadSearch(thread, searchOpen && view === "thread", query);
  const termQuery = useDebounced(searchOpen && view === "terminal" ? query : "", SEARCH_DEBOUNCE_MS);
  const [termCount, setTermCount] = useState(0);
  /** -1: the last (newest) match. */
  const [termIndex, setTermIndex] = useState(-1);
  useEffect(() => setTermIndex(-1), [termQuery]);
  const termCurrent = termCount === 0 ? -1 : termIndex >= 0 && termIndex < termCount ? termIndex : termCount - 1;
  const termSearch = useMemo(() => ({ term: termQuery, index: termIndex, onCount: setTermCount }), [termQuery, termIndex]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    Keyboard.dismiss();
  }, []);

  // Hardware keyboard shortcuts of the session.
  const pressKey = (key: string) => {
    const { rpc } = getHostConn(hostId);
    if (!rpc || conn.status !== "online") return;
    haptics.tap();
    sendKey(rpc, paneId, key).catch((e) => Alert.alert("Can't send the key", message(e)));
  };
  useKeyCommand("interrupt", () => pressKey("ctrl+c"), { enabled: focused });
  useKeyCommand("escape", () => pressKey("esc"), { enabled: focused && view === "terminal" });
  useKeyCommand("toggleMode", () => setMode((m) => (m === "thread" ? "terminal" : "thread")), { enabled: focused && !terminal });
  const neighbors = useMemo(() => (snapshot ? neighborAgents(snapshot, paneId) : {}), [snapshot, paneId]);
  useKeyCommand("prevAgent", () => neighbors.prev && onOpenPane(neighbors.prev), { enabled: focused && neighborShortcuts });
  useKeyCommand("nextAgent", () => neighbors.next && onOpenPane(neighbors.next), { enabled: focused && neighborShortcuts });

  return (
    // Not KeyboardAvoidingView: below the native header it pads too little and the keyboard covers the composer.
    <KeyboardAvoider style={{ backgroundColor: colors.bg }}>
      <SessionHeader
        placement={header}
        hostId={hostId}
        paneId={paneId}
        kind={kind}
        terminal={terminal}
        title={title}
        subtitle={terminal ? `${hostName} · ${termStatus ? statusLabel(termStatus) : "Terminal"}` : kind ? `${hostName} · ${kind}` : hostName}
        menu={menu}
      />
      <View style={{ gap: space.sm, paddingTop: space.xs, paddingBottom: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingLeft: space.lg, paddingRight: space.xs }}>
          {terminal ? (
            // A terminal has no Thread: its folder takes the place of the switch.
            <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1 }}>
              {folder ?? ""}
            </Text>
          ) : (
            <Segmented options={MODES} value={mode} onChange={setMode} label="View" style={{ flex: 1 }} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={view === "thread" ? "Search the thread" : "Search the terminal"}
            accessibilityState={{ expanded: searchOpen }}
            onPress={() => {
              haptics.tap();
              if (searchOpen) closeSearch();
              else setSearchOpen(true);
            }}
            style={HEADER_BUTTON}
          >
            <Search size={icon.md} color={searchOpen ? colors.accent : colors.text} />
          </Pressable>
        </View>
        {searchOpen ? (
          view === "thread" ? (
            <SearchBar
              query={query}
              onQuery={setQuery}
              placeholder="Search the thread"
              count={threadSearch.count}
              label={countLabel(threadSearch.index, threadSearch.count, threadSearch.term)}
              onOlder={threadSearch.older}
              onNewer={threadSearch.newer}
              onClose={closeSearch}
              busy={threadSearch.seeking}
              excerpt={threadSearch.excerpt}
              note={threadSearch.note}
              action={
                threadSearch.canSeek && threadSearch.index <= 0 && !threadSearch.seeking
                  ? { label: "Search older messages", onPress: threadSearch.older }
                  : undefined
              }
            />
          ) : (
            <SearchBar
              query={query}
              onQuery={setQuery}
              placeholder="Search the terminal"
              count={termCount}
              label={countLabel(termCurrent, termCount, termQuery)}
              onOlder={() => setTermIndex(step(termCurrent, termCount, -1))}
              onNewer={() => setTermIndex(step(termCurrent, termCount, 1))}
              onClose={closeSearch}
            />
          )
        ) : null}
        {voiceNotice ? (
          <Text variant="caption" muted accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg }}>
            {voiceNotice}
          </Text>
        ) : null}
      </View>
      {view === "thread" ? (
        <SwipeBetweenAgents hostId={hostId} paneId={paneId} openPane={onOpenPane}>
          <SearchMarksContext.Provider value={threadSearch.marks}>
            <ThreadBody thread={thread} hostId={hostId} paneId={paneId} focused={focused} badge={badge} background={background} focusId={threadSearch.currentId} />
          </SearchMarksContext.Provider>
        </SwipeBetweenAgents>
      ) : (
        // Terminal mode types straight into the pane: key row + one-line box instead of the prompt composer.
        <TerminalView
          hostId={hostId}
          paneId={paneId}
          controls
          shell={terminal}
          active={active}
          bottomInset={keyboard ? 0 : insets.bottom}
          search={termSearch}
        />
      )}
      {/* Hidden, not unmounted, in Terminal mode and while searching: a half-typed prompt survives. Hidden, it polls nothing. A terminal has no composer. */}
      {terminal ? null : (
        <View style={{ display: mode === "thread" && !searchOpen ? "flex" : "none" }}>
          <Composer
            hostId={hostId}
            paneId={paneId}
            bottomInset={keyboard ? 0 : insets.bottom}
            initialText={promptError ? prompt : undefined}
            initialError={promptError ? `Prompt not sent: ${promptError}` : undefined}
            visible={mode === "thread" && focused && !searchOpen}
          />
        </View>
      )}
    </KeyboardAvoider>
  );
}
