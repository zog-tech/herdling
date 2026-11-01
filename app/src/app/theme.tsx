import { Check } from "lucide-react-native";
import { View } from "react-native";

import { ACCENTS, THEMES, buildColors } from "@/theme/palettes";
import { useThemePrefs } from "@/theme/themePrefs";
import { NIGHT_WATCH, colors, icon, radius, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";

const SWATCH = icon.lg + space.xs;

/** The page color of a theme with a dot of its text color. The edge keeps a black swatch visible. */
function ThemeSwatch({ bg, text }: { bg: string; text: string }) {
  return (
    <View
      style={{
        width: SWATCH,
        height: SWATCH,
        borderRadius: radius.sm,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ width: space.md, height: space.md, borderRadius: space.md / 2, backgroundColor: text }} />
    </View>
  );
}

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
 * Settings, "Theme": the palette and the accent color. A change applies at once: the screens
 * mount again in the new colors (see `ui/useThemeRemount`). Only dark themes; see MASTER.md, "Themes".
 */
export default function ThemeScreen() {
  const theme = useThemePrefs((s) => s.theme);
  const accent = useThemePrefs((s) => s.accent);
  const setTheme = useThemePrefs((s) => s.setTheme);
  const setAccent = useThemePrefs((s) => s.setAccent);
  return (
    <Screen flush>
      <Section title="Preview">
        <Preview />
      </Section>
      <Section title="Theme">
        <Group>
          {THEMES.map((t) => {
            const c = buildColors(NIGHT_WATCH, { theme: t.id, accent });
            const on = t.id === theme;
            return (
              <Row
                key={t.id}
                accessibilityLabel={`Theme ${t.label}${on ? ", selected" : ""}`}
                onPress={() => {
                  if (on) return;
                  haptics.tap();
                  setTheme(t.id);
                }}
                leading={<ThemeSwatch bg={c.bg} text={c.text} />}
                title={t.label}
                detail={t.detail}
                trailing={on ? <Check size={icon.md} color={colors.accent} /> : null}
              />
            );
          })}
        </Group>
      </Section>
      <Section title="Accent" footer="The accent marks the primary action, the selected item and the working lantern.">
        <Group>
          {ACCENTS.map((a) => {
            const on = a.id === accent;
            return (
              <Row
                key={a.id}
                accessibilityLabel={`Accent ${a.label}${on ? ", selected" : ""}`}
                onPress={() => {
                  if (on) return;
                  haptics.tap();
                  setAccent(a.id);
                }}
                leading={<AccentSwatch color={a.accent} />}
                title={a.label}
                detail={a.blocked ? "Needs you turns rose, so it is not the same as working." : undefined}
                trailing={on ? <Check size={icon.md} color={colors.accent} /> : null}
              />
            );
          })}
        </Group>
      </Section>
    </Screen>
  );
}
