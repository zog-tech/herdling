import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "@/theme/tokens";

let cached: boolean | undefined;

/**
 * True when the system draws Liquid Glass (iOS 26 and later). The value does not change while the
 * app runs, so the first answer is kept. A missing native module counts as "not available".
 */
export function glassAvailable(): boolean {
  if (cached !== undefined) return cached;
  try {
    cached = Platform.OS === "ios" && isLiquidGlassAvailable();
  } catch {
    cached = false;
  }
  return cached;
}

/** Test hook: forget the kept answer. */
export function resetGlassCache(): void {
  cached = undefined;
}

type Props = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** A color that tints the glass, for example gold for the primary action. */
  tint?: string;
  /** The glass reacts to a touch (iOS 26 shimmer and scale). Use it on a control. */
  interactive?: boolean;
  /** Fill where Liquid Glass is not available. Default: `colors.glassFallback`. */
  fallback?: string;
  pointerEvents?: "box-none" | "none" | "box-only" | "auto";
  /** Always the fill, never glass: for a control that sits on a glass sheet (glass on glass does not read). */
  solid?: boolean;
};

/**
 * A Liquid Glass surface (`GlassView`, always dark). On iOS 17 to 25 it is a translucent raised
 * fill with a hairline edge, so the layout is the same on every system.
 */
export function GlassSurface({ children, style, tint, interactive, fallback, pointerEvents, solid }: Props) {
  if (glassAvailable() && !solid) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor={tint}
        isInteractive={interactive}
        pointerEvents={pointerEvents}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View
      pointerEvents={pointerEvents}
      style={[{ backgroundColor: fallback ?? tint ?? colors.glassFallback, borderWidth: 1, borderColor: colors.hairline }, style]}
    >
      {children}
    </View>
  );
}
