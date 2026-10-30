import { View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";

const Bar = ({ width, height = 14, align }: { width: `${number}%`; height?: number; align?: "flex-end" }) => (
  <View style={{ width, height, borderRadius: radius.sm, backgroundColor: colors.card, alignSelf: align }} />
);

/**
 * The shape of a thread while the first page loads: a user bubble, a reply, a tool card.
 * Static (no shimmer), so it needs nothing under Reduce Motion. Hidden from VoiceOver, which hears
 * "Loading conversation" once.
 */
export function ThreadSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Loading conversation"
      accessibilityLiveRegion="polite"
      style={{ flex: 1, justifyContent: "flex-end", gap: space.lg, padding: space.lg }}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ gap: space.lg }}>
        <Bar width="55%" height={40} align="flex-end" />
        <View style={{ gap: space.sm }}>
          <Bar width="90%" />
          <Bar width="80%" />
          <Bar width="60%" />
        </View>
        <Bar width="100%" height={44} />
        <View style={{ gap: space.sm }}>
          <Bar width="85%" />
          <Bar width="40%" />
        </View>
      </View>
    </View>
  );
}
