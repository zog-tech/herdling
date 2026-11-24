/**
 * One session: the chat (Thread) or the terminal, the composer, search and the session actions.
 * A pane with no agent (a terminal, such as a plain shell) shows only the terminal.
 * The session route shows it full screen with its own header row (`SessionHeader`, placement
 * "native": the back button, the title, the mode switch and "⋯"). The detail column of Overview
 * (regular width) shows the same row with no back button on top.
 */
import type { PortInfo } from "@herdling/protocol";
import { Stack, useIsFocused, useRouter } from "expo-router";
import {
  Bell,
  BellOff,
  ChevronLeft,
  CircleHelp,
  Cpu,
  Ellipsis,
  GitCompareArrows,
  Globe,
  History,
  MessageSquareText,
  MonitorSmartphone,
  Pencil,
  RotateCcw,
  Search,
  Square,
  SquareTerminal,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useSessionBackground } from "@/board/useSessionBackground";
import { getHostConn, useHostConn } from "@/hosts/connection";
import { listsMethod } from "@/hosts/methods";
import { useHosts } from "@/hosts/store";
import { agentLabel } from "@/herdr/agentKinds";
import { agentKind, agentTitle } from "@/herdr/names";
import { neighborAgents } from "@/herdr/neighbors";
import { tabPanes } from "@/herdr/tabPanes";
import { markSeen } from "@/herdr/seen";
import { chooseRestart, confirmDestructive, restartConfirmed, sessionToKeep } from "@/herdr/confirmActions";
import { rememberedArgs } from "@/newSession/startOptionsMemory";
import { useExpectedPane } from "@/herdr/expectedPanes";
import { allows } from "@/herdr/backend";
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
import { mirrorSupportedNow } from "@/mirror/useMirror";
import { portLabel } from "@/preview/preview";
import { usePorts, usePreviewSupported } from "@/preview/usePreview";
import { sendKey } from "@/terminal/keys";
import { NOTIFY_LABEL, STOP_NOTIFY_LABEL, useShellWatch } from "@/terminal/shellWatch";
import { colors, denseScale, hitTarget, icon, space } from "@/theme/tokens";
import { AgentInfoPopover, type Anchor } from "@/thread/AgentInfoPopover";
import { Composer } from "@/thread/Composer";
import { IconButton } from "@/ui/IconButton";
import { PanePager } from "@/thread/PanePager";
import { SwipePanContext } from "@/thread/HScrollView";
import { TerminalView } from "@/thread/TerminalView";
import { PendingBubbles } from "@/thread/items/PendingBubble";
import { modelLabel } from "@/thread/modelLabel";
import { sendWithPending, usePendingList } from "@/thread/pending";
import { canSwitchModel, currentModelChoice, hasModelItem, MODEL_BUSY_MESSAGE, MODELS, modelPrompt } from "@/thread/models";
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
import { showMenu, type MenuItem, type MenuSection } from "@/ui/MenuSheet";
import { Segmented, type SegmentOption } from "@/ui/Segmented";
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
  { id: "thread", label: "Thread", Icon: MessageSquareText },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
] as const satisfies readonly SegmentOption<Mode>[];

/** How long the agent card waits for the measure of the title before it opens without it. */
const MEASURE_WAIT_MS = 150;

/** The agent or terminal mark in the header row. */
const MARK_SIZE = icon.lg + space.xs;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The listening ports of the computer as a menu. A pick opens the browser preview. */
function showPortSheet(hostId: string, paneId: string, ports: PortInfo[], open: (port: number) => void) {
  if (ports.length === 0) {
    Alert.alert("No dev server found", "No process of your user listens on a loopback port of this computer. Start a dev server, then try again.");
    return;
  }
  showMenu({
    title: "Preview",
    detail: "Open a port of this computer",
    sections: [{ items: ports.map((p) => ({ label: portLabel(p, paneId), Icon: Globe, onPick: () => open(p.port) })) }],
  });
}

/**
 * The Claude Code models as a picker, with a check on the model of the agent now. A pick sends
 * `/model <id>` as a prompt, with a pending bubble. The agent status is read at the pick: during a
 * turn, `/model` does not wait in the queue.
 */
function showModelSheet(rpc: Parameters<typeof sendWithPending>[0], hostId: string, paneId: string, current?: string) {
  const now = currentModelChoice(current);
  showMenu({
    title: "Model",
    detail: "Claude Code also keeps the pick as the default for new sessions.",
    sections: [
      {
        items: MODELS.map((m) => ({
          label: m.label,
          checked: m.id === now,
          onPick: () => {
            const status = useSnapshots.getState().byHost[hostId]?.agents.find((a) => a.pane_id === paneId)?.agent_status;
            if (!canSwitchModel(status)) {
              Alert.alert("Can't change the model now", MODEL_BUSY_MESSAGE);
              return;
            }
            sendWithPending(rpc, hostId, paneId, modelPrompt(m)).then(haptics.commit, (e) => {
              haptics.fail();
              Alert.alert("Can't change the model", message(e));
            });
          },
        })),
      },
    ],
  });
}

/** What the session screen gives the menu: the parts of the menu that are not RPC actions. */
type MenuExtras = {
  /** The model of the agent now (`Thread.model`), the value of the Model row. */
  model?: string;
  /** Opens the search of the thread or the terminal. */
  onFind: () => void;
  /** The session title and its detail line, for the menu header. */
  title: string;
  detail: string;
};

/**
 * The "⋯" menu of the session, in sections (design spec, "Session"):
 * - This session: Model (Claude Code; the current model as the value), the renames, Speak replies
 *   (not for a terminal; its state as the value), "Notify me when it finishes" (a terminal on a
 *   host that lists `shell.watch`), Find.
 * - Work: Changes (`git.status`), Preview (the port count as the value), Simulators.
 * - Help: "Why this status?" (a herdr with `agent.explain`).
 * - History: Resume older session (agents with a resume flag).
 * - Last: Restart (agents) and Close, both destructive, both ask first.
 * `openPane` shows another pane in place of this one (after a restart). `closed` runs after Close.
 * `ports` is undefined when the preview does not show for this host.
 * A Herdr 2 pane gets only the items that work there (`allows` in `herdr/backend.ts`).
 * Find and Speak replies work with no connection; the other items need the host.
 */
function useSessionMenu(
  hostId: string,
  paneId: string,
  agent: AgentInfo | undefined,
  terminal: boolean,
  openPane: (paneId: string) => void,
  closed: () => void,
  extras: MenuExtras,
  ports?: PortInfo[],
) {
  const router = useRouter();
  const { rpc, hello } = useHostConn(hostId);
  const [busy, setBusy] = useState<string>();
  const shellWatch = useShellWatch(rpc, hello, paneId, terminal && !agent && allows(paneId, "shellWatch", hostId));
  const speakOn = useSpeakEnabled(hostId, paneId);
  const setSpeak = useSessionSpeak((s) => s.setSpeak);
  const { model, onFind, title, detail } = extras;

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
    if (busy) return;
    const session: MenuItem[] = [];
    const work: MenuItem[] = [];
    const help: MenuItem[] = [];
    const history: MenuItem[] = [];
    const last: MenuItem[] = [];
    const modelValue = modelLabel(model);

    if (rpc && agent && hasModelItem(agent.agent)) {
      session.push({ label: "Model", Icon: Cpu, value: modelValue, onPick: () => showModelSheet(rpc, hostId, paneId, model) });
    }
    if (rpc && agent && allows(agent, "rename", hostId)) {
      session.push(...renameItems(rpc, hostId, agent).map((it) => ({ ...it, Icon: Pencil })));
    }
    if (!terminal) {
      session.push({
        label: "Speak replies",
        Icon: speakOn ? Volume2 : VolumeX,
        value: speakOn ? "On" : "Off",
        onPick: () => setSpeak(sessionKey(hostId, paneId), !speakOn),
      });
    }
    if (rpc && shellWatch.supported) {
      session.push({
        label: shellWatch.watched ? STOP_NOTIFY_LABEL : NOTIFY_LABEL,
        Icon: shellWatch.watched ? BellOff : Bell,
        onPick: () => run("Saving…", "Can't change the notification", shellWatch.toggle),
      });
      // herdlingd removes the watch after the push: ask again for the next time the menu opens.
      shellWatch.refresh();
    }
    session.push({ label: "Find", Icon: Search, onPick: onFind });

    if (rpc && listsMethod(hello, "git.status")) {
      work.push({ label: "Changes", Icon: GitCompareArrows, onPick: () => router.push(`/changes/${hostId}/${paneId}` as never) });
    }
    if (rpc && ports) {
      work.push({
        label: "Preview",
        Icon: Globe,
        value: ports.length > 0 ? String(ports.length) : undefined,
        onPick: () => showPortSheet(hostId, paneId, ports, (port) => router.push(`/preview/${hostId}/${port}` as never)),
      });
    }
    // The device mirror: the simulators and emulators of the computer.
    if (rpc && mirrorSupportedNow(hostId)) {
      work.push({ label: "Simulators", Icon: MonitorSmartphone, onPick: () => router.push(`/devices/${encodeURIComponent(hostId)}` as never) });
    }
    // herdr 0.9 explains its status detection. Hidden after the host refused the method once.
    if (rpc && agent && allows(agent, "explain", hostId) && herdrSupports(hostId, EXPLAIN_METHOD)) {
      help.push({ label: EXPLAIN_LABEL, Icon: CircleHelp, onPick: () => router.push(`/explain/${hostId}/${paneId}` as never) });
    }
    if (rpc && agent?.agent && allows(agent, "resume", hostId) && canResume(hello, agent.agent)) {
      history.push({ label: "Resume older session", Icon: History, onPick: () => router.push(`/resume/${hostId}/${paneId}` as never) });
    }
    if (rpc && agent && allows(agent, "restart", hostId)) {
      last.push({
        label: "Restart",
        Icon: RotateCcw,
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
    if (rpc && (agent || terminal)) {
      const [what, why] = agent
        ? ["Close this agent?", "The agent stops and its pane closes."]
        : ["Close this terminal?", "The shell and the programs in it stop, and the pane closes."];
      last.push({
        label: "Close",
        Icon: X,
        destructive: true,
        onPick: async () => {
          const ok = await confirmDestructive(what, why, "Close");
          if (!ok) return;
          // The last pane of a workspace with worktrees: herdr asks for group intent (`closeWithGroupIntent`).
          // A Herdr 2 pane has no worktree group: it never closes a whole workspace.
          const workspaceId = !allows(paneId, "closeGroup", hostId)
            ? undefined
            : agent?.workspace_id ?? useSnapshots.getState().byHost[hostId]?.panes.find((p) => p.pane_id === paneId)?.workspace_id;
          run("Closing…", "Can't close", async () => {
            if (await closeWithGroupIntent(rpc, workspaceId, () => closeAgent(rpc, paneId))) closed();
          });
        },
      });
    }

    const sections: MenuSection[] = [
      { title: "This session", items: session },
      { title: "Work", items: work },
      { title: "Help", items: help },
      { title: "History", items: history },
      { items: last },
    ];
    showMenu({ title, detail, sections });
  }, [rpc, hello, agent, terminal, busy, run, router, hostId, paneId, openPane, closed, ports, shellWatch, speakOn, setSpeak, model, onFind, title, detail]);

  // The "Change model" row of the agent card: the same sheet as the "Model" item.
  const changeModel = rpc && agent && hasModelItem(agent.agent) ? () => showModelSheet(rpc, hostId, paneId, model) : undefined;

  return { open, busy, enabled: !busy, ports, changeModel };
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
            ? "Computer offline."
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

/**
 * The agent (or terminal) mark, then the title (two lines before it ends with "…") and one detail
 * line: "host · agent · model", or the busy text of the menu. A terminal can add its folder as a
 * last line, in mono. A tap on an agent's title drops down the agent card (the agent and its
 * model). A long press opens the menu.
 */
function SessionTitle({
  kind,
  terminal,
  title,
  subtitle,
  folder,
  menu,
  model,
}: {
  kind: string | undefined;
  terminal: boolean;
  title: string;
  subtitle: string;
  folder?: string;
  menu: Menu;
  model: string | undefined;
}) {
  const ref = useRef<ComponentRef<typeof View> | null>(null);
  const [card, setCard] = useState<{ anchor: Anchor | undefined }>();
  const agentKind = terminal ? undefined : kind;
  const openCard = () => {
    haptics.tap();
    const el = ref.current;
    // Without a measure (rare), the card opens at the top of the screen.
    let placed = false;
    const fallback = setTimeout(() => !placed && setCard({ anchor: undefined }), MEASURE_WAIT_MS);
    el?.measureInWindow?.((x, y, width, height) => {
      placed = true;
      clearTimeout(fallback);
      setCard({ anchor: { x, y, width, height } });
    });
  };
  const closeCard = () => setCard(undefined);
  return (
    <Pressable
      ref={ref}
      onPress={agentKind ? openCard : undefined}
      onLongPress={menu.open}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={agentKind ? "Shows the agent and its model. Long press for session actions" : "Long press for session actions"}
      style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hitTarget, paddingVertical: space.xs }}
    >
      {terminal ? <TerminalMark size={MARK_SIZE} /> : kind ? <AgentMark kind={kind} size={MARK_SIZE} /> : null}
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Text variant="headline" numberOfLines={folder ? 1 : 2} maxFontSizeMultiplier={denseScale.row}>
          {title}
        </Text>
        <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          {menu.busy ?? subtitle}
        </Text>
        {folder ? (
          <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="head" maxFontSizeMultiplier={denseScale.row}>
            {folder}
          </Text>
        ) : null}
      </View>
      {agentKind ? (
        <AgentInfoPopover
          visible={!!card}
          anchor={card?.anchor}
          kind={agentKind}
          model={model}
          onClose={closeCard}
          onChangeModel={
            menu.changeModel
              ? () => {
                  closeCard();
                  // After the card closes, so the card and the sheet do not overlap.
                  setTimeout(() => menu.changeModel?.(), 0);
                }
              : undefined
          }
        />
      ) : null}
    </Pressable>
  );
}

/**
 * The session header: one row. Back (placement "native" only), the mark, the title and its detail
 * line, then at the right "Stop reading" (only while speech plays), the Thread / Terminal switch
 * (only when the session has a Thread) and "⋯". The "⋯" dot: the computer has a listening dev port
 * that "Preview" can open.
 *
 * "native": the session route. The row replaces the native bar (the native bar cannot hold two
 * title lines, the detail line and the switch); the back button and "⋯" are on glass, as the
 * native bar buttons of the other screens. "inline": the detail column of the two-column layout.
 */
export function SessionHeader({
  placement,
  kind,
  terminal = false,
  title,
  subtitle,
  folder,
  menu,
  model,
  mode,
  onMode,
  onBack,
}: {
  placement: "native" | "inline";
  /** The agent kind, for the mark before the title. Unknown: no mark. */
  kind: string | undefined;
  /** A pane with no agent: the terminal mark. */
  terminal?: boolean;
  title: string;
  subtitle: string;
  /** The folder line of a session with no Thread (a terminal). */
  folder?: string;
  menu: Menu;
  /** The model the agent uses now (`Thread.model`), for the agent card. Undefined when unknown. */
  model?: string;
  /** The view and its switch. No `onMode`: the session has no Thread, so no switch. */
  mode: Mode;
  onMode?: (m: Mode) => void;
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const speaking = useSpeaking((s) => s.speaking);
  const native = placement === "native";
  const dot = !!menu.ports && menu.ports.length > 0 && !menu.busy;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingTop: native ? insets.top : 0,
        paddingLeft: native ? space.sm + insets.left : space.lg,
        paddingRight: space.sm + (native ? insets.right : 0),
        paddingBottom: space.xs,
      }}
    >
      {native ? (
        <>
          {/* The native bar is off: the row draws the back button. The swipe back still works. */}
          <Stack.Screen options={{ headerShown: false }} />
          <IconButton label="Back" Icon={ChevronLeft} size="header" glass onPress={() => onBack?.()} />
        </>
      ) : null}
      <SessionTitle kind={kind} terminal={terminal} title={title} subtitle={subtitle} folder={folder} menu={menu} model={model} />
      {/* While speech plays, this button stops it. The speaker setting stays as it is. */}
      {!terminal && speaking ? (
        <IconButton
          label="Stop reading"
          color={colors.accent}
          onPress={() => {
            haptics.tap();
            stopSpeaking();
          }}
        >
          <Square size={icon.sm} color={colors.accent} fill={colors.accent} strokeWidth={icon.strokeWidth} />
        </IconButton>
      ) : null}
      {onMode ? <Segmented options={MODES} value={mode} onChange={onMode} label="View" /> : null}
      <IconButton
        label={dot ? "Session actions, dev server found" : "Session actions"}
        Icon={Ellipsis}
        size="header"
        glass={native}
        dot={dot}
        disabled={!menu.enabled}
        busy={!!menu.busy}
        onPress={menu.open}
      >
        {menu.busy ? <DelayedSpinner color={colors.textMuted} /> : undefined}
      </IconButton>
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
  /** The back button of the "native" header. */
  onBack?: () => void;
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
  onBack,
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
  // A Herdr 2 agent of an older herdlingd has no transcript: it shows only its terminal, like a shell.
  const threadOk = allows(agent ?? paneId, "thread", hostId);
  const view: Mode = terminal || !threadOk ? "terminal" : mode;
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
  // Search: in the thread items (Thread) or in the visible terminal text (Terminal).
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const model = modelLabel(thread.model);
  const subtitle = terminal
    ? `${hostName} · ${termStatus ? statusLabel(termStatus) : "Terminal"}`
    : [hostName, kind ? agentLabel(kind) : undefined, model].filter(Boolean).join(" · ");
  // A session with no Thread shows its folder in the header, where the old switch row showed it.
  const folderLine = terminal ? folder : !threadOk ? (agent?.cwd ?? undefined) : undefined;
  const menu = useSessionMenu(
    hostId,
    paneId,
    agent,
    terminal,
    onOpenPane,
    onClosed,
    { model: thread.model, onFind: openSearch, title, detail: folderLine ?? subtitle },
    ports,
  );

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
  useKeyCommand("toggleMode", () => setMode((m) => (m === "thread" ? "terminal" : "thread")), { enabled: focused && !terminal && threadOk });
  // ⌘F opens the search of the thread or the terminal.
  useKeyCommand("find", openSearch, { enabled: focused });
  const neighbors = useMemo(() => (snapshot ? neighborAgents(snapshot, paneId) : {}), [snapshot, paneId]);
  // The other panes of this tab: page dots, a swipe and the tab map. Null for a tab with one pane.
  const tab = useMemo(() => tabPanes(snapshot, paneId), [snapshot, paneId]);
  useKeyCommand("prevAgent", () => neighbors.prev && onOpenPane(neighbors.prev), { enabled: focused && neighborShortcuts });
  useKeyCommand("nextAgent", () => neighbors.next && onOpenPane(neighbors.next), { enabled: focused && neighborShortcuts });

  return (
    // Not KeyboardAvoidingView: below the native header it pads too little and the keyboard covers the composer.
    <KeyboardAvoider style={{ backgroundColor: colors.bg }}>
      <SessionHeader
        placement={header}
        kind={kind}
        terminal={terminal}
        title={title}
        subtitle={subtitle}
        folder={folderLine}
        menu={menu}
        model={thread.model}
        mode={view}
        onMode={terminal || !threadOk ? undefined : setMode}
        onBack={onBack}
      />
      <View style={{ gap: space.sm, paddingBottom: tab || searchOpen || voiceNotice ? space.sm : 0 }}>
        {tab ? <PanePager tab={tab} onOpen={onOpenPane} /> : null}
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
      {terminal || !threadOk ? null : (
        <View style={{ display: mode === "thread" && !searchOpen ? "flex" : "none" }}>
          <Composer
            hostId={hostId}
            paneId={paneId}
            bottomInset={keyboard ? 0 : insets.bottom}
            initialText={promptError ? prompt : undefined}
            initialError={promptError ? `Prompt not sent: ${promptError}` : undefined}
            visible={mode === "thread" && focused && !searchOpen}
            model={thread.model}
          />
        </View>
      )}
    </KeyboardAvoider>
  );
}
