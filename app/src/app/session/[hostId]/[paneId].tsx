import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Ellipsis, TriangleAlert, Volume2, VolumeX } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { agentKind, agentTitle } from "@/herdr/names";
import { neighborAgents } from "@/herdr/neighbors";
import { markSeen } from "@/herdr/seen";
import { useStatusSince } from "@/herdr/statusSince";
import { confirmDestructive, confirmRestart, restartConfirmed } from "@/herdr/confirmActions";
import { renameItems } from "@/herdr/rename";
import { closeAgent } from "@/herdr/sessionActions";
import type { AgentInfo } from "@/herdr/snapshot";
import { useSnapshots } from "@/herdr/snapshotStore";
import { colors, hitTarget, motion, radius, space } from "@/theme/tokens";
import { Composer } from "@/thread/Composer";
import { SwipePanContext } from "@/thread/HScrollView";
import { TerminalView } from "@/thread/TerminalView";
import { PendingBubbles } from "@/thread/items/PendingBubble";
import { usePendingList } from "@/thread/pending";
import { ThreadList } from "@/thread/ThreadList";
import { ThreadSkeleton } from "@/thread/ThreadSkeleton";
import { ThreadLogContext } from "@/thread/ThreadLogContext";
import { useThread, type Thread } from "@/thread/useThread";
import * as haptics from "@/ui/haptics";
import { HorizonLine } from "@/ui/HorizonLine";
import { type BadgeStatus } from "@/ui/StatusIcon";
import { isStatusShown, StatusRow } from "@/ui/StatusRow";
import { Text } from "@/ui/Text";
import { sessionKey, useSessionSpeak, useSpeakEnabled } from "@/voice/settings";
import { useSpeakReplies } from "@/voice/useSpeakReplies";
import { useVoiceNotice } from "@/voice/voiceNotice";
import { DelayedSpinner } from "@/ui/Delayed";

type Mode = "thread" | "terminal";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Restart, Resume (Claude only), the three renames and Close for the session's agent. */
function useSessionMenu(hostId: string, agent: AgentInfo | undefined, back: () => void) {
  const router = useRouter();
  const { rpc } = useHostConn(hostId);
  const [busy, setBusy] = useState<string>();

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
    if (!rpc || !agent || busy) return;
    const items: { label: string; destructive?: boolean; onPick: () => void }[] = [
      {
        label: "Restart",
        destructive: true,
        onPick: async () => {
          const ok = await confirmRestart();
          if (ok)
            run("Restarting…", "Can't restart", () =>
              restartConfirmed(rpc, agent, (paneId) => router.replace(`/session/${hostId}/${paneId}` as never)),
            );
        },
      },
    ];
    if (agent.agent === "claude") {
      items.push({
        label: "Resume older session",
        onPick: () => router.push(`/resume/${hostId}/${agent.pane_id}` as never),
      });
    }
    items.push(
      ...renameItems(rpc, hostId, agent),
      {
        label: "Close",
        destructive: true,
        onPick: async () => {
          const ok = await confirmDestructive("Close this agent?", "The agent stops and its pane closes.", "Close");
          if (ok)
            run("Closing…", "Can't close", async () => {
              await closeAgent(rpc, agent.pane_id);
              back();
            });
        },
      },
    );
    const options = [...items.map((i) => i.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: items.length,
        destructiveButtonIndex: items.flatMap((it, i) => (it.destructive ? [i] : [])),
      },
      (i) => items[i]?.onPick(),
    );
  }, [rpc, agent, busy, run, router, hostId, back]);

  return { open, busy, enabled: !!rpc && !!agent && !busy };
}

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

const SEG_PAD = 3;

/**
 * Thread / Terminal. The selected pill is one absolute view that slides to the selected segment
 * with a spring, on the UI thread. Reduce Motion: it moves at once.
 */
function Segmented({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const options: { id: Mode; label: string }[] = [
    { id: "thread", label: "Thread" },
    { id: "terminal", label: "Terminal" },
  ];
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const segW = width > 0 ? (width - SEG_PAD * 2) / options.length : 0;
  const index = Math.max(0, options.findIndex((o) => o.id === mode));
  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    const to = index * segW;
    // The first layout places the pill; later changes slide it.
    if (reduced || !placed.current) x.set(to);
    else x.set(withSpring(to, motion.segment));
    if (segW > 0) placed.current = true;
  }, [index, segW, reduced, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.md, padding: SEG_PAD, marginHorizontal: space.lg }}
    >
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: SEG_PAD,
              bottom: SEG_PAD,
              left: SEG_PAD,
              width: segW,
              borderRadius: radius.sm + 1,
              backgroundColor: colors.raised,
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
            },
            pill,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.id === mode;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (o.id !== mode) haptics.tap();
              onChange(o.id);
            }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{
              flex: 1,
              minHeight: hitTarget - 8,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm + 1,
              // Before the first layout there is no pill: the selected segment carries its own fill.
              backgroundColor: active && segW === 0 ? colors.raised : "transparent",
            }}
          >
            <Text variant="small" bold={active} muted={!active}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
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
function SwipeBetweenAgents({ hostId, paneId, children }: { hostId: string; paneId: string; children: ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const { prev, next } = useMemo(() => (snapshot ? neighborAgents(snapshot, paneId) : {}), [snapshot, paneId]);
  const x = useSharedValue(0);

  const go = useCallback(
    (target: string) => {
      haptics.tap();
      router.replace(`/session/${hostId}/${target}` as never);
    },
    [router, hostId],
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
  since,
}: {
  thread: Thread;
  hostId: string;
  paneId: string;
  focused: boolean;
  badge: BadgeStatus;
  since?: number;
}) {
  const { status, items } = thread;
  const pending = usePendingList(hostId, paneId);
  if (status === "no_session") {
    return (
      <View style={{ flex: 1 }}>
        <Text variant="caption" muted style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          No conversation log for this agent. Showing its terminal.
        </Text>
        <TerminalView hostId={hostId} paneId={paneId} />
        <StatusRow status={badge} since={since} />
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
        <StatusRow status={badge} since={since} />
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
      <ThreadLogContext.Provider value={thread.ref?.log_path ? { hostId, logPath: thread.ref.log_path } : null}>
        <ThreadList
          items={items}
          loadOlder={thread.loadOlder}
          loadingOlder={thread.loadingOlder}
          hasOlder={thread.hasOlder}
          tail={<PendingBubbles hostId={hostId} paneId={paneId} />}
          footer={<StatusRow status={badge} since={since} />}
          footerShown={isStatusShown(badge)}
          live={{ hostId, paneId, active: focused }}
        />
      </ThreadLogContext.Provider>
    </View>
  );
}

export default function SessionScreen() {
  const { hostId, paneId, prompt, promptError, from } = useLocalSearchParams<{
    hostId: string;
    paneId: string;
    /** Set by New session when the first prompt failed after the agent started. */
    prompt?: string;
    promptError?: string;
    /** "push" when a notification opened the session. */
    from?: string;
  }>();
  const router = useRouter();
  // Only the focused session speaks and polls choices: another session or a modal may sit on top.
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const [mode, setMode] = useState<Mode>("thread");
  const conn = useHostConn(hostId);
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const thread = useThread(hostId, paneId, agent?.agent_status);

  const speakOn = useSpeakEnabled(hostId, paneId);
  const setSpeak = useSessionSpeak((s) => s.setSpeak);
  useSpeakReplies(hostId, paneId, agent?.agent_status, thread.items, { speakNow: from === "push", focused });
  const voiceNotice = useVoiceNotice((s) => s.text);

  // Opening the session, and every status change seen here, counts as seen.
  const seq = agent?.state_change_seq;
  useEffect(() => {
    if (seq !== undefined) markSeen(hostId, paneId, seq);
  }, [hostId, paneId, seq]);

  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const title = agent && snapshot ? agentTitle(snapshot, agent) : thread.ref?.kind || paneId;
  const kind = agent ? agentKind(agent) : thread.ref?.kind;
  const badge: BadgeStatus = conn.status !== "online" ? "offline" : (agent?.agent_status ?? "unknown");
  const since = useStatusSince(hostId, paneId, agent?.agent_status);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);
  const menu = useSessionMenu(hostId, agent, back);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top, gap: space.sm, paddingBottom: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingRight: space.lg, gap: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={back}
            style={{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={26} color={colors.text} />
          </Pressable>
          <Pressable
            onLongPress={menu.open}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint="Long press for session actions"
            style={{ flex: 1, minHeight: hitTarget, justifyContent: "center" }}
          >
            <Text bold numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {menu.busy ?? (kind ? `${hostName} · ${kind}` : hostName)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Speak replies"
            accessibilityState={{ checked: speakOn }}
            onPress={() => {
              haptics.tap();
              setSpeak(sessionKey(hostId, paneId), !speakOn);
            }}
            style={{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" }}
          >
            {speakOn ? <Volume2 size={22} color={colors.accent} /> : <VolumeX size={22} color={colors.textMuted} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Session actions"
            accessibilityState={{ disabled: !menu.enabled, busy: !!menu.busy }}
            disabled={!menu.enabled}
            onPress={menu.open}
            style={{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" }}
          >
            {menu.busy ? (
              <DelayedSpinner color={colors.textMuted} />
            ) : (
              <Ellipsis size={22} color={menu.enabled ? colors.text : colors.textMuted} />
            )}
          </Pressable>
        </View>
        <Segmented mode={mode} onChange={setMode} />
        {voiceNotice ? (
          <Text variant="caption" muted accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg }}>
            {voiceNotice}
          </Text>
        ) : null}
        {/* The horizon hairline: the header's bottom edge. */}
        <HorizonLine style={{ position: "absolute", left: 0, right: 0, bottom: 0 }} />
      </View>
      {mode === "thread" ? (
        <SwipeBetweenAgents hostId={hostId} paneId={paneId}>
          <ThreadBody thread={thread} hostId={hostId} paneId={paneId} focused={focused} badge={badge} since={since} />
        </SwipeBetweenAgents>
      ) : (
        // Terminal mode types straight into the pane: key row + one-line box instead of the prompt composer.
        <TerminalView hostId={hostId} paneId={paneId} controls bottomInset={keyboard ? 0 : insets.bottom} />
      )}
      {/* Hidden, not unmounted, in Terminal mode: a half-typed prompt survives a mode switch. Hidden, it polls nothing. */}
      <View style={{ display: mode === "thread" ? "flex" : "none" }}>
        <Composer
          hostId={hostId}
          paneId={paneId}
          bottomInset={keyboard ? 0 : insets.bottom}
          initialText={promptError ? prompt : undefined}
          initialError={promptError ? `Prompt not sent: ${promptError}` : undefined}
          visible={mode === "thread" && focused}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
