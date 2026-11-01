import { X } from "lucide-react-native";
import { useEffect, useMemo, useRef } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markSeen, useSeen } from "@/herdr/seen";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useHosts } from "@/hosts/store";
import { colors, space } from "@/theme/tokens";
import { Composer } from "@/thread/Composer";
import { AssistantMessage } from "@/thread/items/AssistantMessage";
import { useThread } from "@/thread/useThread";
import { GlassButton } from "@/ui/GlassButton";
import { glassAvailable } from "@/ui/Glass";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider, useKeyboardShown } from "@/ui/KeyboardAvoider";
import { useSheetKeyboardPad } from "@/ui/sheetKeyboard";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

import { BucketStatus } from "./BucketStatus";
import { useBoard } from "./boardStore";
import { mergeBoard } from "./buckets";
import { PEEK_DETENT_ANDROID } from "./peekDetent";

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
  const keyboard = useSheetKeyboardPad(PEEK_DETENT_ANDROID);
  const keyboardShown = useKeyboardShown();
  const snapshot = useSnapshots((s) => s.byHost[hostId]);
  const hostName = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.name ?? hostId);
  const preview = useBoard((s) => s.previews[`${hostId}:${paneId}`]);
  const firstSeen = useBoard((s) => s.firstSeen);
  const seen = useSeen((s) => s.seen);
  const agent = snapshot?.agents.find((a) => a.pane_id === paneId);
  const thread = useThread(hostId, paneId, agent?.agent_status);

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

  const title = item?.title ?? paneId;

  // Header fixed at the top, the reply fills the space between, the composer sits at the bottom
  // above the keyboard. `minHeight: 0` lets the reply shrink to fit the 0.6 detent.
  const body = (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.md,
          paddingLeft: space.lg,
          paddingRight: space.md,
          paddingTop: space.xl,
          paddingBottom: space.md,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" numberOfLines={2} accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {item ? item.subtitle : hostName}
          </Text>
          {/* Own row: the status never squeezes "<host> · <kind>". */}
          {item ? (
            <View style={{ flexDirection: "row", marginTop: space.xs }}>
              <BucketStatus bucket={item.bucket} />
            </View>
          ) : null}
        </View>
        <GlassButton
          label="Open session"
          onGlass={glassAvailable()}
          title="Open"
          onPress={() => {
            haptics.press();
            onOpenSession();
          }}
        />
        {onClose ? <GlassButton label="Close" Icon={X} onGlass={glassAvailable()} onPress={onClose} /> : null}
      </View>

      {!agent ? (
        <Text muted style={{ paddingHorizontal: space.lg }}>
          This agent is gone.
        </Text>
      ) : null}

      {(item?.bucket === "working" || item?.bucket === "background") && item.line ? (
        <Text
          variant="small"
          mono={item.bucket === "working"}
          muted={item.bucket === "background"}
          numberOfLines={2}
          style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}
        >
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

      <Composer
        hostId={hostId}
        paneId={paneId}
        // The keyboard covers the navigation bar, so the composer needs no bottom inset above it.
        bottomInset={keyboard.pad > 0 || (Platform.OS === "ios" && keyboardShown) ? 0 : insets.bottom}
        autoFocus={focusComposer}
        onDraftChange={onDraftChange}
      />
    </>
  );

  // Android: the sheet is `card`, so it stands out from the page behind it. The keyboard pad
  // replaces the avoiding view (see `useSheetKeyboardPad`).
  if (Platform.OS === "android") {
    return (
      <View ref={keyboard.ref} style={{ flex: 1, backgroundColor: colors.card, paddingBottom: keyboard.pad }}>
        {body}
      </View>
    );
  }
  // iOS 26: the sheet itself is Liquid Glass at the partial detent, so the page color stays off it.
  // The sheet ends at the bottom of the screen.
  return (
    <KeyboardAvoider atScreenBottom style={{ backgroundColor: glassAvailable() ? "transparent" : colors.bg }}>
      {body}
    </KeyboardAvoider>
  );
}
