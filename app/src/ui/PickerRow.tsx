import { ChevronRight, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { actionBar, colors, hitTarget, icon, space, state } from "@/theme/tokens";

import { useInGroup } from "./Group";
import { pickedOption, showPicker, type PickerOptions } from "./PickerSheet";
import { Text } from "./Text";

/**
 * The row of a choice from a list that can grow (design rule 2): the title at the left, the
 * current value and a chevron at the right. A tap opens `ui/PickerSheet`. It replaces every
 * selector chip. The row keeps its place when the list grows.
 *
 * ```tsx
 * <Group>
 *   <PickerRow
 *     title="Agent"
 *     picker={{ options: agentOptions, value: agent, onPick: setAgent }}
 *   />
 *   <PickerRow title="Folder" value={path} mono onPress={openBrowser} />
 * </Group>
 * ```
 *
 * - `picker`: the row opens `showPicker` itself (the sheet title is the row title unless
 *   `picker.title` is set), and the value is the label of the picked option, with its `leading`.
 * - `onPress`: the row only shows `value` and runs `onPress` (a folder browser, a sub-page).
 * - `mono`: the value in JetBrains Mono, cut in the middle (a path).
 * - `expanded`: the row opens an inline area under it (with `onPress`). VoiceOver hears
 *   "expanded" or "collapsed", and the chevron points down while the area is open.
 * - `detail` is one line under the title; `detailTone="danger"` with `DetailIcon` makes a warning.
 * - At a large text size (from `actionBar.stackFontScale`) the value goes under the title.
 */
type Common = {
  title: string;
  /** The current value as text. With `picker`, default: the label of the picked option. */
  value?: string;
  /** The text when there is no value, for example "Choose". */
  placeholder?: string;
  /** A lucide icon at the left of the title (20 pt, `textMuted`). */
  Icon?: LucideIcon;
  /** Free content at the left of the title, in place of `Icon`. */
  leading?: ReactNode;
  /** Content just before the value, for example the agent mark. With `picker`, default: the option's `leading`. */
  valueLeading?: ReactNode;
  /** One line under the title. */
  detail?: string;
  detailTone?: "muted" | "danger";
  /** An icon before the detail, for example a warning triangle. */
  DetailIcon?: LucideIcon;
  /** The value in mono, cut in the middle. */
  mono?: boolean;
  /** The row shows or hides an inline area: `accessibilityState.expanded` and a turned chevron. */
  expanded?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

export type PickerRowProps<T> = Common &
  (
    | { picker: Omit<PickerOptions<T>, "title"> & { title?: string }; onPress?: undefined }
    | { onPress: () => void; picker?: undefined }
  );

export function PickerRow<T>(props: PickerRowProps<T>) {
  const { title, placeholder, Icon, leading, detail, detailTone = "muted", DetailIcon, mono, expanded, disabled, accessibilityHint, picker } = props;
  const inGroup = useInGroup();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= actionBar.stackFontScale;
  const picked = picker ? pickedOption(picker.sections ?? [{ options: picker.options ?? [] }], picker.value) : undefined;
  const value = props.value ?? picked?.label;
  const valueLeading = props.valueLeading ?? picked?.leading;
  const shown = value ?? placeholder;
  const press = picker ? () => showPicker({ ...picker, title: picker.title ?? title }) : props.onPress;
  const detailColor = detailTone === "danger" ? colors.danger : colors.textMuted;

  const valueView = shown ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1, maxWidth: stacked ? "100%" : "60%" }}>
      {valueLeading}
      <Text muted mono={mono} numberOfLines={1} ellipsizeMode={mono ? "middle" : "tail"} style={{ flexShrink: 1 }}>
        {shown}
      </Text>
    </View>
  ) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityValue={shown ? { text: shown } : undefined}
      accessibilityHint={accessibilityHint ?? (picker ? "Opens a list to choose from." : undefined)}
      accessibilityState={{ disabled: !!disabled, ...(expanded !== undefined ? { expanded } : null) }}
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: inGroup ? space.lg : 0,
        paddingVertical: inGroup ? space.md : 0,
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: disabled ? state.disabledOpacity : 1,
      })}
    >
      {leading ?? (Icon ? <Icon size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} /> : null)}
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text>{title}</Text>
        {detail ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {DetailIcon ? <DetailIcon size={icon.sm} color={detailColor} strokeWidth={icon.strokeWidth} /> : null}
            <Text variant="small" color={detailColor} style={{ flexShrink: 1 }}>
              {detail}
            </Text>
          </View>
        ) : null}
        {stacked ? valueView : null}
      </View>
      {stacked ? null : valueView}
      <ChevronRight
        size={icon.md}
        color={colors.textMuted}
        strokeWidth={icon.strokeWidth}
        style={expanded ? { transform: [{ rotate: "90deg" }] } : undefined}
      />
    </Pressable>
  );
}
