import { View } from "react-native";

import { ACCENTS, TERMINAL_THEMES, THEMES, type TerminalThemeId, type ThemeId } from "@/theme/palettes";
import { useThemePrefs } from "@/theme/themePrefs";
import { colors, icon, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Group, Pad, Section } from "@/ui/Group";
import { PickerRow } from "@/ui/PickerRow";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";

/** The size of a menu row icon, so the swatch lines up with the icons of other menus. */
const SWATCH = icon.md;

/** The accent color as a round swatch, the leading part of an accent option. */
function AccentSwatch({ color }: { color: string }) {
  return <View style={{ width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, backgroundColor: color }} />;
}

/** A small Board row and a primary button in the current colors. */
function Preview() {
  return (
    <Group>
      <Pad>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline" numberOfLines={1}>
              api-server
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              claude · studio.local
            </Text>
          </View>
          <View style={{ gap: space.xs, alignItems: "flex-end" }}>
            <StatusDot label="Working" color={colors.status.working} lit />
            <StatusDot label="Needs you" color={colors.status.blocked} />
          </View>
        </View>
        <Button label="Approve" onPress={() => haptics.tap()} />
      </Pad>
    </Group>
  );
}

/**
 * More, Appearance, "Theme": the palette, the accent color and the terminal screen. A change applies
 * at once: the screens mount again in the new colors (see `ui/useThemeRemount`). Only dark themes;
 * see MASTER.md, "Themes". The three themes and the two terminal screens are fixed choices, so they
 * are `Segmented` controls (design rule 2); the five accents are a `PickerRow` with a swatch.
 */
export default function ThemeScreen() {
  const theme = useThemePrefs((s) => s.theme);
  const accent = useThemePrefs((s) => s.accent);
  const setTheme = useThemePrefs((s) => s.setTheme);
  const setAccent = useThemePrefs((s) => s.setAccent);
  const terminal = useThemePrefs((s) => s.terminal ?? "app");
  const setTerminal = useThemePrefs((s) => s.setTerminal);
  const themeNow = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const accentNow = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];
  const terminalNow = TERMINAL_THEMES.find((t) => t.id === terminal) ?? TERMINAL_THEMES[0];
  return (
    <Screen flush>
      <Section title="Preview">
        <Preview />
      </Section>
      <Section>
        <Group>
          <Row
            title="Theme"
            detail={themeNow.detail}
            below={
              <Segmented<ThemeId>
                options={THEMES.map((t) => ({ id: t.id, label: t.label }))}
                value={theme}
                onChange={(id) => {
                  if (id !== theme) setTheme(id);
                }}
                label="Theme"
              />
            }
          />
          <PickerRow
            title="Accent"
            detail={accentNow.blocked ? "Needs you turns rose, so it is not the same as working." : "The primary action, the selected item and the working lantern."}
            picker={{
              options: ACCENTS.map((a) => ({
                value: a.id,
                label: a.label,
                leading: <AccentSwatch color={a.accent} />,
                detail: a.blocked ? "Needs you turns rose." : undefined,
              })),
              value: accent,
              onPick: setAccent,
            }}
          />
          <Row
            title="Terminal"
            detail={`${terminalNow.detail} The rest of the app keeps the theme.`}
            below={
              <Segmented<TerminalThemeId>
                options={TERMINAL_THEMES.map((t) => ({ id: t.id, label: t.label }))}
                value={terminal}
                onChange={(id) => {
                  if (id !== terminal) setTerminal(id);
                }}
                label="Terminal screen"
              />
            }
          />
        </Group>
      </Section>
    </Screen>
  );
}
