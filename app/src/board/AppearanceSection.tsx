import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";

import { accentDef, themeDef } from "@/theme/palettes";
import { useThemePrefs } from "@/theme/themePrefs";
import { colors, icon } from "@/theme/tokens";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import * as haptics from "@/ui/haptics";

import { HOME_TOPS, ROW_STYLES, useBoardPrefs } from "./boardPrefs";

/**
 * Settings, "Appearance": a row that opens the Theme screen, the top of the Board, then the agent
 * list style. One row for each choice, a check on the selected one. A list, not a segmented control:
 * "Rows with arrows" does not fit a segment. The theme has its own short screen: a theme change
 * mounts the screens again, and on a short screen the user does not lose the scroll position.
 */
export function AppearanceSection() {
  const router = useRouter();
  const rowStyle = useBoardPrefs((s) => s.rowStyle);
  const setRowStyle = useBoardPrefs((s) => s.setRowStyle);
  const theme = useThemePrefs((s) => s.theme);
  const accent = useThemePrefs((s) => s.accent);
  const homeTop = useBoardPrefs((s) => s.homeTop);
  const setHomeTop = useBoardPrefs((s) => s.setHomeTop);
  return (
    <>
      <Section title="Appearance">
        <Group>
          <Row
            title="Theme"
            detail={`${themeDef(theme).label}, ${accentDef(accent).label}`}
            chevron
            onPress={() => router.push("/theme" as never) /* typed routes regenerate on the next dev start */}
          />
        </Group>
      </Section>
      <Section title="Overview top" footer="What the Overview tab shows above the agent list.">
        <Group>
          {HOME_TOPS.map((o) => (
            <Row
              key={o.id}
              accessibilityLabel={`Overview top ${o.label}${o.id === homeTop ? ", selected" : ""}`}
              onPress={() => {
                if (o.id !== homeTop) haptics.tap();
                setHomeTop(o.id);
              }}
              title={o.label}
              detail={o.detail}
              trailing={o.id === homeTop ? <Check size={icon.md} color={colors.accent} /> : null}
            />
          ))}
        </Group>
      </Section>
      <Section title="Agent list style" footer="How the Board shows each agent.">
        <Group>
          {ROW_STYLES.map((o) => (
            <Row
              key={o.id}
              accessibilityLabel={`Agent list style ${o.label}${o.id === rowStyle ? ", selected" : ""}`}
              onPress={() => {
                if (o.id !== rowStyle) haptics.tap();
                setRowStyle(o.id);
              }}
              title={o.label}
              detail={o.detail}
              trailing={o.id === rowStyle ? <Check size={icon.md} color={colors.accent} /> : null}
            />
          ))}
        </Group>
      </Section>
    </>
  );
}
