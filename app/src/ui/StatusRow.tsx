import { memo, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react-native";
import { AccessibilityInfo, Pressable, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { colors, motion, radius, space, threadGap } from "@/theme/tokens";
import { subagentCount, type SubagentList } from "@/thread/subagentState";
import { SubagentSheet } from "@/thread/SubagentSheet";
import { StatusGlyph } from "./StatusGlyph";
import { spokenDuration } from "./format";
import { STATUS_META, statusSpoken, useElapsed, type BadgeStatus } from "./StatusIcon";
import { Text } from "./Text";
import { SPOKEN_TICK_MS, TickingDuration } from "./TickingDuration";

/** Only these states show a row. Idle, done and unknown hide it, unless background work runs. */
const SHOWN: readonly BadgeStatus[] = ["working", "blocked", "offline"];
/** These states show the row while background work runs: "Idle · 1 shell running". */
const QUIET: readonly BadgeStatus[] = ["idle", "done"];
/** Height of the thread pill. */
export const PILL_HEIGHT = 40;
/** Icon size in a thread pill. */
export const ROW_ICON = 20;
/** Space between the newest message and the pill. Same as the gap between two thread rows. */
export const PILL_GAP = threadGap;
const ROW_HEIGHT = PILL_HEIGHT + PILL_GAP;
const SLIDE = 6;
const EASE_OUT = Easing.bezier(...motion.ease.out);

/** The pill clock shows seconds under this many minutes: "42s", "9m 59s", then "10m" and "1h 4m". */
export const PILL_SECONDS_UNTIL = 10;

/** Hide-and-show time of the pill, so the list can keep it in view while it grows. */
export const STATUS_ANIM_MS = motion.stateMs;

/**
 * Whether this state shows the pill. `background`: the text of the background work, if any.
 * `running`: the number of running subagents. They show the pill also when the agent is quiet.
 */
export const isStatusShown = (status: BadgeStatus, background?: string, running = 0) =>
  SHOWN.includes(status) || running > 0 || (!!background && QUIET.includes(status));

/**
 * What the pill shows. `status`: the icon and the color. `detail`: the muted text after the label.
 * `since`: epoch ms when the working state began; the pill ends with a clock from it.
 */
export type PillContent = { status: BadgeStatus; label: string; detail?: string; since?: number; tappable: boolean; spoken: string };

/**
 * The text and the state of the one pill. Working: "Working", and "· 2 subagents" while subagents run.
 * Quiet agent with running subagents: "2 subagents running" with the working indicator. Quiet agent with
 * background work only: "Idle · 1 shell running". A pill with running subagents opens the subagent sheet.
 * `since` (epoch ms) and `elapsedS`: the start of the working state and the time since then. Only a working
 * agent shows the clock ("Working · 2 subagents · 12m"). VoiceOver reads the time in whole minutes.
 */
export function pillContent(status: BadgeStatus, background?: string, running = 0, since?: number, elapsedS?: number): PillContent {
  const tappable = running > 0;
  if (status === "working") {
    const detail = tappable ? subagentCount(running) : undefined;
    const time = since !== undefined ? spokenDuration(elapsedS ?? 0) : undefined;
    const spoken = [statusSpoken(status), detail, time].filter((p) => p !== undefined).join(", ");
    return { status, label: STATUS_META[status].label, detail, since, tappable, spoken };
  }
  if (!SHOWN.includes(status) && tappable) {
    const label = `${subagentCount(running)} running`;
    return { status: "working", label, tappable, spoken: label };
  }
  const detail = QUIET.includes(status) ? background : undefined;
  const spoken = statusSpoken(status);
  return { status, label: STATUS_META[status].label, detail, tappable: false, spoken: detail ? `${spoken}, ${detail}` : spoken };
}

/** What VoiceOver says on a change: only work that finishes, and "Needs you". */
export function announcement(from: BadgeStatus, to: BadgeStatus): string | undefined {
  if (to === "blocked" && from !== "blocked") return STATUS_META.blocked.label;
  if (from === "working" && (to === "done" || to === "idle")) return "Finished";
  return undefined;
}

/**
 * Agent status pill, the last item of the thread list (below the newest message). It is the one pill
 * for the agent and its subagents. Working shows the icon and "Working". The pill is centered, fades and
 * slides in and out, and takes no height when hidden.
 * `subagents`: the subagents of the turn. While some run, the pill adds the count, shows a chevron and
 * a tap opens the subagent sheet. A quiet agent with running subagents shows "2 subagents running".
 * `background`: background work of an idle agent ("1 shell running"); the pill shows "Idle · 1 shell running".
 * `since`: the start of the working state; the pill ends with a clock ("Working · 1m 12s"). The clock ticks on
 * the UI thread once a second (`TickingDuration`), with tabular digits, and only while the pill shows and
 * `active` (the screen is focused) is true.
 */
export const StatusRow = memo(function StatusRow({
  status,
  subagents,
  background,
  since,
  active = true,
}: {
  status: BadgeStatus;
  subagents?: SubagentList;
  background?: string;
  /** Epoch ms when the current status began (the companion's `status_since`). Missing: no clock. */
  since?: number;
  /** False while the screen is not focused: the clock stops. */
  active?: boolean;
}) {
  const reduced = useReducedMotion();
  const running = subagents?.running.length ?? 0;
  const visible = isStatusShown(status, background, running);
  // The clock runs only while the pill shows and the screen is focused.
  const ticking = visible && active && status === "working" && since !== undefined;
  // Coarse JS clock, for the VoiceOver label only. The shown clock ticks on the UI thread.
  const elapsed = useElapsed(status === "working" ? since : undefined, ticking, SPOKEN_TICK_MS);
  const content = pillContent(status, background, running, since, elapsed);
  // Keep the last shown content, so the pill stays the same while the row fades out.
  const [last, setLast] = useState<PillContent>(content);
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(visible ? 1 : 0);
  const prev = useRef(status);

  useEffect(() => {
    if (visible) setLast(pillContent(status, background, running, since, elapsed));
  }, [status, background, running, since, elapsed, visible]);

  useEffect(() => {
    if (!visible) setOpen(false);
    const to = visible ? 1 : 0;
    if (reduced) {
      progress.set(to);
      return;
    }
    const ms = visible ? motion.stateMs : motion.stateMs * motion.exitRatio;
    progress.set(withTiming(to, { duration: ms, easing: EASE_OUT }));
  }, [visible, reduced, progress]);

  useEffect(() => {
    const said = announcement(prev.current, status);
    prev.current = status;
    if (said) AccessibilityInfo.announceForAccessibility(said);
  }, [status]);

  const view = visible ? content : last;
  const { color } = STATUS_META[view.status];

  const style = useAnimatedStyle(() => ({
    height: progress.get() * ROW_HEIGHT,
    opacity: progress.get(),
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * SLIDE }],
  }));

  const body = (
    <>
      <StatusGlyph status={view.status} glow={view.status === "working"} size={ROW_ICON} />
      <Text variant="small" bold color={color} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {view.label}
      </Text>
      {view.detail ? (
        <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {`· ${view.detail}`}
        </Text>
      ) : null}
      {view.since !== undefined ? (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text variant="small" muted maxFontSizeMultiplier={1.3}>
            {"· "}
          </Text>
          <TickingDuration
            variant="small"
            since={view.since}
            active={ticking}
            secondsUntil={PILL_SECONDS_UNTIL}
            maxFontSizeMultiplier={1.3}
            accessible={false}
          />
        </View>
      ) : null}
      {view.tappable ? <ChevronRight size={16} color={colors.textMuted} /> : null}
    </>
  );
  const pill = {
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
  } as const;

  return (
    <>
      <Animated.View
        style={[{ overflow: "hidden" }, style]}
        pointerEvents={visible && view.tappable ? "box-none" : "none"}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      >
        {view.tappable ? (
          <Pressable
            accessible={visible}
            accessibilityRole="button"
            accessibilityLabel={view.spoken}
            accessibilityHint="Shows the subagents"
            onPress={() => setOpen(true)}
            style={({ pressed }) => ({ ...pill, backgroundColor: pressed ? colors.card : colors.raised })}
          >
            {body}
          </Pressable>
        ) : (
          <View accessible={visible} accessibilityRole="text" accessibilityLabel={view.spoken} style={{ ...pill, backgroundColor: colors.raised }}>
            {body}
          </View>
        )}
      </Animated.View>
      {subagents ? <SubagentSheet visible={open} list={subagents} onClose={() => setOpen(false)} /> : null}
    </>
  );
});
