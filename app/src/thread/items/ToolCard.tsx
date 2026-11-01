import { useRouter } from "expo-router";
import { Check, ChevronDown, ChevronRight, CircleX, Maximize2 } from "lucide-react-native";
import { memo, useContext, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, state as uiState, type } from "@/theme/tokens";
import { spokenDuration } from "@/ui/format";
import { StatusIcon, useElapsed } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";
import { TopHighlight } from "@/ui/TopHighlight";
import { SPOKEN_TICK_MS, TickingDuration } from "@/ui/TickingDuration";

import { HScrollView } from "../HScrollView";
import { LinkedText } from "../LinkText";
import { LiveToolContext } from "../LiveToolContext";
import { MenuPressable } from "../MenuPressable";
import { toolCopyText } from "../rowMenu";
import { lastLines, openToolView, refreshToolView, toolTime, type ToolResult } from "../toolView";
import { useTerminalText } from "../useTerminalText";

const MAX_INPUT_CHARS = 4000;
/** Lines of live output a running card shows. */
export const LIVE_LINES = 30;
/** Live output refresh while the card is open. */
export const LIVE_REFRESH_MS = 1_500;

function inputText(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  return s.length > MAX_INPUT_CHARS ? `${s.slice(0, MAX_INPUT_CHARS)}\n…` : s;
}

function Block({ label, text, color }: { label: string; text: string; color?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <HScrollView showsHorizontalScrollIndicator={false} style={{ backgroundColor: colors.sunken, borderRadius: radius.sm }}>
        <Text
          selectable
          style={{
            fontFamily: fontFamily.mono,
            fontSize: type.size.caption,
            lineHeight: 18,
            color: color ?? colors.text,
            padding: space.sm,
          }}
        >
          <LinkedText text={text} />
        </Text>
      </HScrollView>
    </View>
  );
}

/** The last lines of the agent's pane, read while `enabled`. */
function LiveOutput({ hostId, paneId, enabled }: { hostId: string; paneId: string; enabled: boolean }) {
  const { text, error } = useTerminalText(hostId, paneId, enabled, { refreshMs: LIVE_REFRESH_MS, lines: LIVE_LINES });
  if (text === undefined && !error) {
    return (
      <Text variant="caption" muted>
        Reading live output…
      </Text>
    );
  }
  return <Block label="Live output" text={text !== undefined ? lastLines(text, LIVE_LINES) || "(empty)" : `Can't read the screen: ${error}`} />;
}

/**
 * One tool call: collapsed to `Name · summary` with its state and time; tap shows input and result.
 * A running card shows a spinner and a ticking timer. Opened, the newest running card shows the
 * pane's live output. "Expand" opens the full tool view. A long press on the header opens the
 * row menu: Copy (name, input and result) and Select text.
 */
export const ToolCard = memo(function ToolCard({
  id,
  ts,
  name,
  inputSummary,
  input,
  result,
}: {
  id: string;
  ts: number;
  name: string;
  inputSummary: string;
  input: unknown;
  result?: ToolResult;
}) {
  const router = useRouter();
  const live = useContext(LiveToolContext);
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const state = !result ? "running" : result.ok ? "ok" : "failed";
  const running = state === "running";
  const ticking = running && ts > 0;
  const clockOn = ticking && (live?.active ?? true);
  // The timer on screen ticks on the UI thread. This coarse JS clock is for the VoiceOver label.
  const elapsed = useElapsed(ticking ? ts : undefined, clockOn, SPOKEN_TICK_MS);
  const time = running ? undefined : toolTime(ts, result, Date.now());
  const spokenTime = running ? (elapsed !== undefined ? spokenDuration(elapsed) : undefined) : time;
  const polls = !!live && open && running && live.active && live.newestRunningId === id;

  // Keep the full view fresh when it shows this tool.
  useEffect(() => {
    if (live) refreshToolView({ id, hostId: live.hostId, paneId: live.paneId, name, input, ts, result });
  }, [live, id, name, input, ts, result]);

  const expand = () => {
    if (!live) return;
    openToolView({ id, hostId: live.hostId, paneId: live.paneId, name, input, ts, result });
    router.push("/tool" as never);
  };

  const stateLabel = running ? "running" : state === "ok" ? "done" : "failed";
  const stateColor = running ? colors.status.working : state === "ok" ? colors.status.done : colors.danger;
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.edge, backgroundColor: colors.card, overflow: "hidden" }}>
      <TopHighlight inset={radius.md} />
      <MenuPressable
        menu={{ kind: "tool", text: toolCopyText(name, input, result) }}
        accessibilityRole="button"
        accessibilityLabel={`${name} ${inputSummary}, ${stateLabel}${spokenTime ? `, ${spokenTime}` : ""}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          minHeight: hitTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          // Pressed: the raised fill, so the row reads as one control.
          backgroundColor: pressed ? colors.raised : "transparent",
        })}
      >
        {running ? (
          <StatusIcon status="working" size={14} />
        ) : state === "ok" ? (
          <Check size={14} color={colors.status.done} />
        ) : (
          <CircleX size={14} color={colors.danger} />
        )}
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fontFamily.mono, fontSize: type.size.small - 1 }}>
          <Text style={{ fontFamily: fontFamily.monoBold, fontSize: type.size.small - 1 }}>{name}</Text>
          {inputSummary ? <Text muted style={{ fontFamily: fontFamily.mono, fontSize: type.size.small - 1 }}>{` · ${inputSummary}`}</Text> : null}
        </Text>
        {state === "failed" ? (
          <Text variant="caption" bold color={colors.danger}>
            Failed
          </Text>
        ) : null}
        {ticking ? (
          <TickingDuration since={ts} active={clockOn} muted={false} color={stateColor} accessible={false} />
        ) : time ? (
          <Text variant="caption" color={colors.textMuted} style={{ fontVariant: ["tabular-nums"] }}>
            {time}
          </Text>
        ) : null}
        <Chevron size={14} color={colors.textMuted} />
      </MenuPressable>
      {open ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
          <Block label="Input" text={inputText(input) || "(none)"} />
          {result ? (
            <Block
              label={result.ok ? (result.truncated ? "Result (truncated)" : "Result") : "Error"}
              text={result.text || "(empty)"}
              color={result.ok ? undefined : colors.danger}
            />
          ) : live && live.newestRunningId === id ? (
            <LiveOutput hostId={live.hostId} paneId={live.paneId} enabled={polls} />
          ) : (
            <Text variant="caption" muted>
              Running…
            </Text>
          )}
          {live ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Expand"
              accessibilityHint="Opens the full input and output"
              onPress={expand}
              style={({ pressed }) => ({
                alignSelf: "flex-end",
                width: hitTarget,
                height: hitTarget,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? uiState.pressedOpacity : 1,
              })}
            >
              <Maximize2 size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});
