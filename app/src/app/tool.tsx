import * as Clipboard from "expo-clipboard";
import { useIsFocused, useRouter } from "expo-router";
import { Copy, RotateCcw, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { GestureDetector, usePinchGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, space, state } from "@/theme/tokens";
import { fullInputText, lastLines, toolTime, useToolView } from "@/thread/toolView";
import { useTerminalText } from "@/thread/useTerminalText";
import { LIVE_REFRESH_MS } from "@/thread/items/ToolCard";
import * as haptics from "@/ui/haptics";
import { StatusIcon } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";
import { TickingDuration } from "@/ui/TickingDuration";

/** Font size range of the pinch zoom, in points. */
export const FONT_MIN = 10;
export const FONT_MAX = 24;
const FONT_DEFAULT = 13;
/** Live output lines in the full view. */
const LIVE_LINES = 200;

export const clampFont = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? state.pressedOpacity : 1 })}
    >
      {children}
    </Pressable>
  );
}

/**
 * Full tool view (a modal; swipe down or Close). Tool name, full input and output (or live output
 * while it runs) in monospace, scrolls both ways. Pinch changes the font size (10–24 pt): the pinch
 * scales the text on the UI thread, and the new size is set once when the fingers lift.
 */
export default function ToolScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const view = useToolView((s) => s.current);
  const [font, setFont] = useState(FONT_DEFAULT);
  const [copied, setCopied] = useState(false);
  const running = !!view && !view.result;
  const live = useTerminalText(view?.hostId ?? "", view?.paneId ?? "", running && focused, {
    refreshMs: LIVE_REFRESH_MS,
    lines: LIVE_LINES,
  });

  const scale = useSharedValue(1);
  const commitScale = useCallback((s: number) => setFont((f) => clampFont(f * s)), []);
  const pinch = usePinchGesture({
    onUpdate: (e) => {
      scale.set(e.scale);
    },
    onDeactivate: (e) => {
      scale.set(1);
      scheduleOnRN(commitScale, e.scale);
    },
  });
  const zoom = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  if (!view) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: space.md }}>
        <Text muted>Nothing to show.</Text>
        <IconButton label="Close" onPress={close}>
          <X size={22} color={colors.text} />
        </IconButton>
      </View>
    );
  }

  const output = view.result
    ? view.result.text || "(empty)"
    : live.text !== undefined
      ? lastLines(live.text, LIVE_LINES) || "(empty)"
      : live.error
        ? `Can't read the screen: ${live.error}`
        : "Reading live output…";
  const outLabel = view.result ? (view.result.ok ? (view.result.truncated ? "Result (truncated)" : "Result") : "Error") : "Live output";
  const input = fullInputText(view.input) || "(none)";
  // A running tool shows a clock that ticks on the UI thread; a finished one shows its run time.
  const ticking = running && view.ts > 0;
  const time = ticking ? undefined : toolTime(view.ts, view.result, Date.now());
  const mono = { fontFamily: fontFamily.mono, fontSize: font, lineHeight: Math.round(font * 1.4), color: colors.text };

  const copy = async () => {
    await Clipboard.setStringAsync(`${view.name}\n\nInput:\n${input}\n\n${outLabel}:\n${output}`);
    haptics.commit();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: insets.bottom }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingLeft: space.lg,
          paddingRight: space.xs,
          paddingTop: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.divider,
        }}
      >
        {running ? <StatusIcon status="working" size={18} /> : null}
        <View style={{ flex: 1 }}>
          <Text bold numberOfLines={1} accessibilityRole="header" style={{ fontFamily: fontFamily.monoBold }}>
            {view.name}
          </Text>
          {ticking ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text variant="caption" muted numberOfLines={1}>
                {"Running · "}
              </Text>
              <TickingDuration since={view.ts} active={focused} />
              <Text variant="caption" muted numberOfLines={1}>
                {` · ${font} pt`}
              </Text>
            </View>
          ) : (
            <Text variant="caption" muted numberOfLines={1}>
              {[running ? "Running" : view.result?.ok ? "Done" : "Failed", time, `${font} pt`].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
        <IconButton label="Reset text size" onPress={() => setFont(FONT_DEFAULT)}>
          <RotateCcw size={20} color={font === FONT_DEFAULT ? colors.textMuted : colors.text} />
        </IconButton>
        <IconButton label={copied ? "Copied" : "Copy"} onPress={() => void copy()}>
          <Copy size={20} color={copied ? colors.status.done : colors.text} />
        </IconButton>
        <IconButton label="Close" onPress={close}>
          <X size={22} color={colors.text} />
        </IconButton>
      </View>
      <GestureDetector gesture={pinch}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg }} accessibilityHint="Pinch to change the text size">
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Animated.View style={[{ gap: space.md, transformOrigin: "top left" }, zoom]}>
              <Text variant="caption" muted>
                Input
              </Text>
              <Text selectable style={mono}>
                {input}
              </Text>
              <Text variant="caption" muted>
                {outLabel}
              </Text>
              <Text selectable style={[mono, view.result && !view.result.ok ? { color: colors.danger } : null]}>
                {output}
              </Text>
            </Animated.View>
          </ScrollView>
        </ScrollView>
      </GestureDetector>
    </View>
  );
}
