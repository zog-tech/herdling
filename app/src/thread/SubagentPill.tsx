/**
 * The subagent pill at the bottom of the thread, below the Working pill: "2 subagents running".
 * A tap opens a sheet with the running subagents and the subagents that finished in the current
 * turn. A pick in the sheet opens the subagent thread, as a tap on its card does.
 */
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { memo, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, motion, radius, space } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { formatDuration, spokenDuration } from "@/ui/format";
import { StatusGlyph } from "@/ui/StatusGlyph";
import { PILL_GAP, PILL_HEIGHT, ROW_ICON } from "@/ui/StatusRow";
import { Text } from "@/ui/Text";
import { TickingDuration } from "@/ui/TickingDuration";
import { statusLabel, statusMeta, tools } from "./items/SubagentCard";
import { subagentHref, subagentPillText, type SubagentItem, type SubagentList } from "./subagentState";
import { useThreadLog } from "./ThreadLogContext";

/** Same rhythm as the Working pill: the `threadGap` above the pill, then the pill. */
const ROW_HEIGHT = PILL_HEIGHT + PILL_GAP;
const SLIDE = 6;
const EASE_OUT = Easing.bezier(...motion.ease.out);
const SHEET_ICON = 16;

/** Whether the list shows the pill. */
export const isSubagentPillShown = (list: SubagentList) => subagentPillText(list) !== undefined;

/**
 * The pill row. It fades and slides in and out like the Working pill, and takes no height when
 * hidden. While a subagent runs, it shows the working indicator of the Working pill.
 */
export const SubagentPill = memo(function SubagentPill({ list }: { list: SubagentList }) {
  const reduced = useReducedMotion();
  const text = subagentPillText(list);
  const visible = text !== undefined;
  const running = list.running.length > 0;
  // Keep the last text, so the content stays while the row fades out.
  const [shown, setShown] = useState({ text: text ?? "", running });
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (text !== undefined) setShown({ text, running });
    const to = text !== undefined ? 1 : 0;
    if (reduced) {
      progress.set(to);
      return;
    }
    const ms = to ? motion.stateMs : motion.stateMs * motion.exitRatio;
    progress.set(withTiming(to, { duration: ms, easing: EASE_OUT }));
  }, [text, running, reduced, progress]);

  const style = useAnimatedStyle(() => ({
    height: progress.get() * ROW_HEIGHT,
    opacity: progress.get(),
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * SLIDE }],
  }));

  return (
    <>
      <Animated.View
        style={[{ overflow: "hidden" }, style]}
        pointerEvents={visible ? "box-none" : "none"}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      >
        <Pressable
          accessible={visible}
          accessibilityRole="button"
          accessibilityLabel={shown.text}
          accessibilityHint="Shows the subagents"
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            alignSelf: "center",
            marginTop: PILL_GAP,
            height: PILL_HEIGHT,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: pressed ? colors.card : colors.raised,
          })}
        >
          <StatusGlyph status={shown.running ? "working" : "done"} size={ROW_ICON} />
          <Text variant="small" bold color={shown.running ? colors.status.working : undefined} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {shown.text}
          </Text>
          <ChevronRight size={16} color={colors.textMuted} />
        </Pressable>
      </Animated.View>
      <SubagentSheet visible={open} list={list} onClose={() => setOpen(false)} />
    </>
  );
});

/**
 * The list of subagents: the running ones, then the ones that finished in the current turn.
 * A pick closes the sheet, then opens the subagent thread (on iOS after the sheet is gone).
 */
export function SubagentSheet({ visible, list, onClose }: { visible: boolean; list: SubagentList; onClose: () => void }) {
  const router = useRouter();
  const log = useThreadLog();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const next = useRef<ReturnType<typeof subagentHref>>(undefined);

  const go = () => {
    const href = next.current;
    next.current = undefined;
    if (href) router.push(href as never);
  };
  const pick = (s: SubagentItem) => {
    const href = subagentHref(log, { agentId: s.agent_id, description: s.description, startedAt: s.started_at });
    if (!href) return;
    next.current = href;
    onClose();
    // iOS pushes in `onDismiss`: a push under an open page sheet stays hidden behind it.
    if (Platform.OS !== "ios") go();
  };

  return (
    // A native page sheet: swipe-down closes it (onRequestClose), and so does the close button.
    <Modal
      visible={visible}
      animationType={reduced ? "fade" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={go}
    >
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.md, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Text variant="title" accessibilityRole="header">
            Subagents
          </Text>
          <CloseButton onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
          {list.running.length > 0 ? <Section title="Running" /> : null}
          {list.running.map((s) => (
            <SubagentSheetRow key={s.id} s={s} canOpen={!!subagentHref(log, { agentId: s.agent_id, description: s.description })} onPick={pick} />
          ))}
          {list.finished.length > 0 ? <Section title="Finished in this turn" /> : null}
          {list.finished.map((s) => (
            <SubagentSheetRow key={s.id} s={s} canOpen={!!subagentHref(log, { agentId: s.agent_id, description: s.description })} onPick={pick} />
          ))}
          {list.running.length === 0 && list.finished.length === 0 ? (
            <Text variant="small" muted style={{ paddingVertical: space.lg }}>
              No subagents in this turn.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Text variant="caption" muted bold accessibilityRole="header" style={{ paddingTop: space.sm }}>
      {title}
    </Text>
  );
}

/** "Explore · haiku": the agent type and the model, when the host knows them. */
const kindLine = (s: SubagentItem) => [s.agent_type, s.model].filter((v) => !!v && v.trim()).join(" · ");

/**
 * One subagent in the sheet. Running: the working indicator, a ticking clock and its latest step.
 * Stopped: the status icon, the status and how long it took.
 */
export function SubagentSheetRow({ s, canOpen, onPick }: { s: SubagentItem; canOpen: boolean; onPick: (s: SubagentItem) => void }) {
  const running = s.status === "running";
  const { color, Icon } = statusMeta(s.status);
  const label = statusLabel(s.status);
  const tookS = !running && s.started_at && s.finished_at && s.finished_at >= s.started_at ? (s.finished_at - s.started_at) / 1000 : undefined;
  const kind = kindLine(s);
  const spoken = [
    s.description || "Subagent",
    label,
    tookS !== undefined ? `took ${spokenDuration(tookS)}` : null,
    s.tool_count ? tools(s.tool_count) : null,
    kind || null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      accessibilityRole={canOpen ? "button" : "text"}
      accessibilityLabel={spoken}
      accessibilityHint={canOpen ? "Opens the subagent thread" : undefined}
      disabled={!canOpen}
      onPress={() => onPick(s)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.sm,
        padding: space.md,
        borderWidth: 1,
        borderColor: colors.edge,
        borderRadius: radius.md,
        backgroundColor: pressed && canOpen ? colors.raised : colors.card,
      })}
    >
      <View style={{ paddingTop: 2 }}>
        {running ? <StatusGlyph status="working" size={SHEET_ICON} /> : <Icon size={SHEET_ICON} color={color} />}
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text variant="small" bold numberOfLines={2}>
          {s.description || "Subagent"}
        </Text>
        {kind ? (
          <Text variant="caption" muted numberOfLines={1}>
            {kind}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Text variant="caption" bold color={color}>
            {label}
          </Text>
          {running && s.started_at ? <TickingDuration since={s.started_at} active={running} accessible={false} /> : null}
          {tookS !== undefined ? (
            <Text variant="caption" muted>
              {formatDuration(tookS)}
            </Text>
          ) : null}
          {s.tool_count ? (
            <Text variant="caption" muted numberOfLines={1}>
              {`· ${tools(s.tool_count)}`}
            </Text>
          ) : null}
        </View>
        {running && s.activity ? (
          <Text variant="caption" muted numberOfLines={1}>
            {s.activity}
          </Text>
        ) : null}
      </View>
      {canOpen ? (
        <View style={{ alignSelf: "center" }}>
          <ChevronRight size={18} color={colors.textMuted} />
        </View>
      ) : null}
    </Pressable>
  );
}
