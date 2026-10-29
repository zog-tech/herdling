import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, TriangleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { markSeen } from "@/herdr/seen";
import { useSnapshots } from "@/herdr/snapshotStore";
import { colors, hitTarget, radius, space } from "@/theme/tokens";
import { Composer } from "@/thread/Composer";
import { TerminalView } from "@/thread/TerminalView";
import { ThreadList } from "@/thread/ThreadList";
import { useThread, type Thread } from "@/thread/useThread";
import { StatusBadge, type BadgeStatus } from "@/ui/StatusBadge";
import { Text } from "@/ui/Text";

type Mode = "thread" | "terminal";

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
      <ThreadList items={items} loadOlder={thread.loadOlder} loadingOlder={thread.loadingOlder} hasOlder={thread.hasOlder} />
    </View>
  );
}

export default function SessionScreen() {
  const { hostId, paneId, prompt, promptError } = useLocalSearchParams<{
    hostId: string;
    paneId: string;
    /** Set by New session when the first prompt failed after the agent started. */
    prompt?: string;
    promptError?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const [mode, setMode] = useState<Mode>("thread");
  const conn = useHostConn(hostId);
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const thread = useThread(hostId, paneId, agent?.agent_status);

  // Opening the session, and every status change seen here, counts as seen.
  const seq = agent?.state_change_seq;
  useEffect(() => {
    if (seq !== undefined) markSeen(hostId, paneId, seq);
  }, [hostId, paneId, seq]);

  const title = agent?.terminal_title_stripped || agent?.agent || thread.ref?.kind || paneId;
  const kind = agent?.agent ?? thread.ref?.kind;
  const badge: BadgeStatus = conn.status !== "online" ? "offline" : (agent?.agent_status ?? "unknown");
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

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
          <View style={{ flex: 1 }}>
            <Text bold numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {kind ? `${hostName} · ${kind}` : hostName}
            </Text>
          </View>
          <StatusBadge status={badge} />
        </View>
        <Segmented mode={mode} onChange={setMode} />
      </View>
      {mode === "thread" ? (
        <ThreadBody thread={thread} hostId={hostId} paneId={paneId} />
      ) : (
        <TerminalView hostId={hostId} paneId={paneId} />
      )}
      <Composer
        hostId={hostId}
        paneId={paneId}
        bottomInset={keyboard ? 0 : insets.bottom}
        initialText={promptError ? prompt : undefined}
        initialError={promptError ? `Prompt not sent: ${promptError}` : undefined}
      />
    </KeyboardAvoidingView>
  );
}
