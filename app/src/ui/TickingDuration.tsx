import { memo, useEffect } from "react";
import { TextInput, useWindowDimensions, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedProps, useFrameCallback, useSharedValue } from "react-native-reanimated";

import { formatDuration, spokenDuration } from "./format";
import { useElapsed } from "./StatusIcon";
import { maxScaleOf, textStyle, type TextVariant } from "./Text";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** The JS clock of the VoiceOver label ticks this often. The label shows whole minutes. */
export const SPOKEN_TICK_MS = 15_000;

/** The text a clock that started at `since` (epoch ms) shows at `now`. Runs on both threads. */
export function durationText(since: number, now: number): string {
  "worklet";
  return formatDuration((now - since) / 1000);
}

/**
 * One frame of the clock: the new text when the shown second changed since `lastSec`, else
 * undefined (nothing to write). Runs on the UI thread.
 */
export function tick(since: number, now: number, lastSec: number): { sec: number; text: string } | undefined {
  "worklet";
  const sec = Math.floor((now - since) / 1000);
  if (sec === lastSec) return undefined;
  return { sec, text: durationText(since, now) };
}

type Props = {
  /** Epoch ms when the clock started. */
  since: number;
  /** False pauses the clock (for example while the row is hidden or the screen is not focused). */
  active?: boolean;
  variant?: TextVariant;
  muted?: boolean;
  bold?: boolean;
  color?: string;
  maxFontSizeMultiplier?: number;
  style?: StyleProp<TextStyle>;
  /**
   * False when a parent element already speaks the time (it groups the row for VoiceOver).
   * Otherwise the clock is one element with a label in whole minutes, so VoiceOver does not
   * read a new value every second.
   */
  accessible?: boolean;
};

/**
 * Elapsed time ("12s", "1m 12s", "1h 2m") that ticks once a second on the UI thread, so a busy JS
 * thread cannot freeze it. A frame callback checks the time and writes the text only when the
 * shown second changes. The text is a read-only TextInput whose `text` prop Reanimated sets.
 */
export const TickingDuration = memo(function TickingDuration({
  since,
  active = true,
  variant = "caption",
  muted = true,
  bold,
  color,
  maxFontSizeMultiplier,
  style,
  accessible = true,
}: Props) {
  // Right at each JS render. Between renders the UI thread writes the text.
  const now = Date.now();
  const initial = durationText(since, now);
  const sinceSV = useSharedValue(since);
  const lastSec = useSharedValue(Math.floor((now - since) / 1000));
  const text = useSharedValue(initial);

  useEffect(() => {
    sinceSV.set(since);
    lastSec.set(Math.floor((Date.now() - since) / 1000));
    text.set(durationText(since, Date.now()));
  }, [since, sinceSV, lastSec, text]);

  const frame = useFrameCallback(() => {
    "worklet";
    const next = tick(sinceSV.get(), Date.now(), lastSec.get());
    if (!next) return;
    lastSec.set(next.sec);
    text.set(next.text);
  }, active);

  useEffect(() => {
    frame.setActive(active);
  }, [active, frame]);

  const animatedProps = useAnimatedProps(() => ({ text: text.get(), defaultValue: text.get() }));

  const elapsed = useElapsed(since, active && accessible, SPOKEN_TICK_MS);
  const base = textStyle({ variant, muted, bold, color });
  // The height grows with Dynamic Type, up to the same cap as the text.
  const { fontScale } = useWindowDimensions();
  const height = Math.ceil(base.lineHeight * Math.min(fontScale, maxFontSizeMultiplier ?? maxScaleOf(variant)));
  return (
    <View
      accessible={accessible}
      accessibilityRole={accessible ? "text" : undefined}
      accessibilityLabel={accessible ? spokenDuration(elapsed ?? 0) : undefined}
      importantForAccessibility={accessible ? "yes" : "no-hide-descendants"}
      accessibilityElementsHidden={!accessible}
      pointerEvents="none"
    >
      <AnimatedTextInput
        testID="ticking-duration"
        editable={false}
        caretHidden
        contextMenuHidden
        scrollEnabled={false}
        multiline={false}
        accessible={false}
        importantForAccessibility="no"
        defaultValue={initial}
        animatedProps={animatedProps}
        maxFontSizeMultiplier={maxFontSizeMultiplier ?? maxScaleOf(variant)}
        // A single-line TextInput centers its text in its height and ignores lineHeight. Give it the
        // text role's line height as its height, so it sits on the same line as a Text next to it.
        style={[{ ...base, lineHeight: undefined, height }, { padding: 0, margin: 0, fontVariant: ["tabular-nums"] }, style]}
      />
    </View>
  );
});
