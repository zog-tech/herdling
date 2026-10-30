import { ExternalLink } from "lucide-react-native";
import { useEffect, useMemo, useRef } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markSeen, useSeen } from "@/herdr/seen";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useHosts } from "@/hosts/store";
import { colors, denseScale, hitTarget, radius, space, state } from "@/theme/tokens";
import { Composer } from "@/thread/Composer";
import { AssistantMessage } from "@/thread/items/AssistantMessage";
import { useThread } from "@/thread/useThread";
import { CloseButton } from "@/ui/CloseButton";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

import { StatusPill } from "./StatusPill";
import { useBoard } from "./boardStore";
import { kindIcon } from "./bucketMeta";
import { mergeBoard } from "./buckets";

/**
 * Peek at one agent without opening it: header, the last reply as markdown, permission buttons
 * when blocked, and the composer with hold-to-talk. Closing marks the pane seen.
 */
export function PeekSheet({
  hostId,
  paneId,
  focusComposer,
  onOpenSession,
  onClose,
  onDraftChange,
}: {
  hostId: string;
  paneId: string;
  /** Raise the keyboard at once (the "Reply" swipe action). */
  focusComposer?: boolean;
  onOpenSession: () => void;
  onClose?: () => void;
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const preview = useBoard((s) => s.previews[`${hostId}:${paneId}`]);
  const firstSeen = useBoard((s) => s.firstSeen);
  const seen = useSeen((s) => s.seen);
  const agent = snapshot?.agents.find((a) => a.pane_id === paneId);
  const thread = useThread(hostId, paneId, agent?.agent_status);
  const now = Date.now();

  const item = useMemo(() => {
    if (!agent || !snapshot) return undefined;
    const key = `${hostId}:${paneId}`;
    return mergeBoard(
      [{ hostId, hostName, agents: [agent], workspaces: snapshot.workspaces, tabs: snapshot.tabs, panes: snapshot.panes }],
      preview ? { [key]: preview } : {},
      seen,
      firstSeen,
    )[0];
  }, [agent, snapshot, hostId, paneId, hostName, preview, seen, firstSeen]);

  const lastReply = useMemo(() => {
    for (let i = thread.items.length - 1; i >= 0; i--) {
      const it = thread.items[i];
      if (it.kind === "assistant") return it.markdown;
    }
    return undefined;
  }, [thread.items]);

  // Closing the sheet counts as seeing the pane, at the newest status it had while open.
  const seq = useRef(agent?.state_change_seq);
  seq.current = agent?.state_change_seq ?? seq.current;
  useEffect(() => {
    return () => {
      if (seq.current !== undefined) markSeen(hostId, paneId, seq.current);
    };
  }, [hostId, paneId]);

  const KindIcon = kindIcon(agent?.agent ?? thread.ref?.kind ?? "");
  const title = item?.title ?? paneId;

  return (
    // Header fixed at the top, the reply fills the space between, the composer sits at the bottom
    // above the keyboard. `minHeight: 0` lets the reply shrink to fit the 0.6 detent.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingLeft: space.lg,
          paddingRight: space.sm,
          paddingTop: space.xl,
          paddingBottom: space.md,
        }}
      >
        <View
          style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" }}
        >
          <KindIcon size={20} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" numberOfLines={2} accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {item ? item.subtitle : hostName}
          </Text>
          {/* Own row: the pill never squeezes "<host> · <kind>". */}
          {item ? (
            <View style={{ flexDirection: "row", marginTop: space.xs }}>
              <StatusPill item={item} now={now} />
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open session"
          onPress={() => {
            haptics.press();
            onOpenSession();
          }}
          style={({ pressed }) => ({
            minHeight: hitTarget,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: pressed ? state.pressedFill : 1,
          })}
        >
          <ExternalLink size={16} color={colors.text} />
          <Text variant="small" bold maxFontSizeMultiplier={denseScale.row}>
            Open
          </Text>
        </Pressable>
        {onClose ? <CloseButton onPress={onClose} /> : null}
      </View>

      {!agent ? (
        <Text muted style={{ paddingHorizontal: space.lg }}>
          This agent is gone.
        </Text>
      ) : null}

      {item?.bucket === "working" && item.line ? (
        <Text variant="small" mono numberOfLines={2} style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {item.line}
        </Text>
      ) : null}

      <View style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <ScrollView
          style={{ flex: 1 }}
          // In a native sheet, automatic insets move the content up under the header.
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md }}
          accessibilityLabel="Last reply"
        >
          {lastReply ? (
            <AssistantMessage markdown={lastReply} />
          ) : thread.status === "loading" ? (
            <DelayedSpinner color={colors.textMuted} />
          ) : (
            <Text muted>{preview?.last_reply ?? item?.line ?? "No reply yet."}</Text>
          )}
        </ScrollView>
      </View>

      <Composer hostId={hostId} paneId={paneId} bottomInset={insets.bottom} autoFocus={focusComposer} onDraftChange={onDraftChange} />
    </KeyboardAvoidingView>
  );
}
