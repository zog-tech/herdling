import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, denseScale, space } from "@/theme/tokens";

import { Text } from "./Text";

/** True inside a `Group`: a `Row` then pads itself to the band's inset. */
export const GroupContext = createContext(false);
export const useInGroup = () => useContext(GroupContext);

/**
 * A grouped band: full width, one fill, hairline edges, rows split by inset hairlines. No card box.
 * Use it inside a `Screen` with `flush`. `null` and `false` children take no row.
 */
export function Group({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <GroupContext.Provider value>
      <View
        style={{
          backgroundColor: colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: colors.divider,
        }}
      >
        {rows.map((row, i) => (
          <View key={isValidElement(row) && row.key != null ? row.key : i}>
            {i > 0 ? <Divider /> : null}
            {row}
          </View>
        ))}
      </View>
    </GroupContext.Provider>
  );
}

/** The inset hairline between two rows of a band. */
export function Divider({ inset = space.lg }: { inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: colors.divider }} />;
}

/**
 * A titled part of a grouped list: a small uppercase header (no icon), the content, and an
 * optional footer line in the muted color.
 */
export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row} style={{ paddingHorizontal: space.lg }}>
          {title}
        </Text>
      ) : null}
      {children}
      {footer ? (
        <Text variant="caption" muted style={{ paddingHorizontal: space.lg }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** Free content in a band (not a `Row`): the band inset on all sides. */
export function Pad({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}>{children}</View>;
}
