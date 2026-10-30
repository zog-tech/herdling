import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Ellipsis, TriangleAlert, Volume2, VolumeX } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { neighborAgents } from "@/herdr/neighbors";
import { markSeen } from "@/herdr/seen";
import { closeAgent, renameAgent, restartAgent } from "@/herdr/sessionActions";
import type { AgentInfo } from "@/herdr/snapshot";
import type { RpcClient } from "@/rpc/RpcClient";
import { useSnapshots } from "@/herdr/snapshotStore";
import { colors, hitTarget, radius, space } from "@/theme/tokens";
import { Composer } from "@/thread/Composer";
import { TerminalView } from "@/thread/TerminalView";
import { ThreadList } from "@/thread/ThreadList";
import { ThreadLogContext } from "@/thread/ThreadLogContext";
import { useThread, type Thread } from "@/thread/useThread";
import { StatusBadge, type BadgeStatus } from "@/ui/StatusBadge";
import { Text } from "@/ui/Text";
import { sessionKey, useSessionSpeak, useSpeakEnabled } from "@/voice/settings";
import { useSpeakReplies } from "@/voice/useSpeakReplies";

type Mode = "thread" | "terminal";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A second sheet with one destructive button; resolves true when the user picks it. */
function confirmDestructive(title: string, detail: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message: detail, options: [action, "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => resolve(i === 0),
    ),
  );
}

/** After a restart whose old pane did not close: say so, and offer to close it again. */
function offerCloseOld(rpc: Pick<RpcClient, "call">, paneId: string, error: string) {
  Alert.alert("The old agent is still running", `Can't close it: ${error}`, [
    { text: "Keep it", style: "cancel" },
    {
      text: "Close it",
      style: "destructive",
      onPress: () => closeAgent(rpc, paneId).catch((e) => offerCloseOld(rpc, paneId, message(e))),
    },
  ]);
}

/** Restart, Resume (Claude only), Rename and Close for the session's agent. */
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
          const ok = await confirmDestructive("Restart this agent?", "A new agent starts in a new tab. This pane closes.", "Restart");
          if (ok)
            run("Restarting…", "Can't restart", async () => {
              const oldPane = agent.pane_id;
              const { paneId, closeError } = await restartAgent(rpc, agent);
              router.replace(`/session/${hostId}/${paneId}` as never);
              if (closeError) offerCloseOld(rpc, oldPane, closeError);
            });
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
      {
        label: "Rename",
        onPick: () =>
          Alert.prompt("Rename agent", "Lowercase letters, digits, - or _. Start with a letter.", (name) => {
            const next = name?.trim();
            if (next) run("Renaming…", "Can't rename", () => renameAgent(rpc, agent.pane_id, next));
          }),
      },
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

function Segmented({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const options: { id: Mode; label: string }[] = [
    { id: "thread", label: "Thread" },
    { id: "terminal", label: "Terminal" },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.md, padding: 3, marginHorizontal: space.lg }}
    >
      {options.map((o) => {
        const active = o.id === mode;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.id)}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{
              flex: 1,
              minHeight: hitTarget - 8,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm + 1,
              backgroundColor: active ? colors.muted : "transparent",
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
 */
function SwipeBetweenAgents({ hostId, paneId, children }: { hostId: string; paneId: string; children: ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const { prev, next } = useMemo(() => (snapshot ? neighborAgents(snapshot, paneId) : {}), [snapshot, paneId]);
  const x = useSharedValue(0);

  const go = useCallback(
    (target: string) => {
      Haptics.selectionAsync().catch(() => {});
      router.replace(`/session/${hostId}/${target}` as never);
    },
    [router, hostId],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-30, 30])
        .failOffsetY([-15, 15])
        .onUpdate((e) => {
          // Rubber-band toward a side with no neighbor; no translation at all under Reduce Motion.
          if (reduced) return;
          const open = e.translationX < 0 ? next : prev;
          x.set(e.translationX * (open ? SWIPE_FOLLOW : SWIPE_FOLLOW / 3));
        })
        .onEnd((e) => {
          const far = Math.abs(e.translationX) > SWIPE_DISTANCE || Math.abs(e.velocityX) > SWIPE_VELOCITY;
          const target = e.translationX < 0 ? next : prev;
          x.set(reduced ? 0 : withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: e.velocityX }));
          if (far && target) scheduleOnRN(go, target);
        }),
    [reduced, next, prev, go, x],
  );

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

function ThreadBody({ thread, hostId, paneId }: { thread: Thread; hostId: string; paneId: string }) {
  const { status, items } = thread;
  if (status === "no_session") {
    return (
      <View style={{ flex: 1 }}>
        <Text variant="caption" muted style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          No conversation log for this agent. Showing its terminal.
        </Text>
        <TerminalView hostId={hostId} paneId={paneId} />
      </View>
    );
  }
  if (items.length === 0) {
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
        ) : (
          <ActivityIndicator color={colors.textMuted} />
        )}
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
        <ThreadList items={items} loadOlder={thread.loadOlder} loadingOlder={thread.loadingOlder} hasOlder={thread.hasOlder} />
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
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const [mode, setMode] = useState<Mode>("thread");
  const conn = useHostConn(hostId);
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const thread = useThread(hostId, paneId, agent?.agent_status);

  const speakOn = useSpeakEnabled(hostId, paneId);
  const setSpeak = useSessionSpeak((s) => s.setSpeak);
  useSpeakReplies(hostId, paneId, agent?.agent_status, thread.items, { speakNow: from === "push" });

  // Opening the session, and every status change seen here, counts as seen.
  const seq = agent?.state_change_seq;
  useEffect(() => {
    if (seq !== undefined) markSeen(hostId, paneId, seq);
  }, [hostId, paneId, seq]);

  const title = agent?.terminal_title_stripped || agent?.agent || thread.ref?.kind || paneId;
  const kind = agent?.agent ?? thread.ref?.kind;
  const badge: BadgeStatus = conn.status !== "online" ? "offline" : (agent?.agent_status ?? "unknown");
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);
  const menu = useSessionMenu(hostId, agent, back);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top, gap: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.muted }}>
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
            onPress={() => setSpeak(sessionKey(hostId, paneId), !speakOn)}
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
              <ActivityIndicator color={colors.textMuted} />
            ) : (
              <Ellipsis size={22} color={menu.enabled ? colors.text : colors.textMuted} />
            )}
          </Pressable>
          <StatusBadge status={badge} />
        </View>
        <Segmented mode={mode} onChange={setMode} />
      </View>
      {mode === "thread" ? (
        <SwipeBetweenAgents hostId={hostId} paneId={paneId}>
          <ThreadBody thread={thread} hostId={hostId} paneId={paneId} />
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
          visible={mode === "thread"}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
