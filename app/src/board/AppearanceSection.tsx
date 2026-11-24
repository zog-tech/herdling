import { useRouter } from "expo-router";

import { accentDef, themeDef } from "@/theme/palettes";
import { useThemePrefs } from "@/theme/themePrefs";
import { Group, Section } from "@/ui/Group";
import { PickerRow } from "@/ui/PickerRow";
import { Row } from "@/ui/Row";
import { Segmented } from "@/ui/Segmented";

import { HOME_TOPS, ROW_STYLES, useBoardPrefs, type HomeTop, type RowStyle } from "./boardPrefs";

/**
 * Short segment labels of the agent list styles: "Rows with arrows" does not fit a segment. The
 * row detail says the full meaning of the selected style.
 */
const ROW_STYLE_SEGMENTS: Record<RowStyle, string> = { flat: "Rows", divided: "Arrows", cards: "Cards" };

/**
 * More, "Appearance": a row that opens the Theme screen, the top of the Agents tab, then the agent
 * list style. The two fixed choices are `Segmented` controls (design rule 2) with the detail of the
 * selected option under the title. The theme has its own short screen: a theme change mounts the
 * screens again, and on a short screen the user does not lose the scroll position.
 */
export function AppearanceSection() {
  const router = useRouter();
  const rowStyle = useBoardPrefs((s) => s.rowStyle);
  const setRowStyle = useBoardPrefs((s) => s.setRowStyle);
  const theme = useThemePrefs((s) => s.theme);
  const accent = useThemePrefs((s) => s.accent);
  const homeTop = useBoardPrefs((s) => s.homeTop);
  const setHomeTop = useBoardPrefs((s) => s.setHomeTop);
  const top = HOME_TOPS.find((o) => o.id === homeTop) ?? HOME_TOPS[0];
  const style = ROW_STYLES.find((o) => o.id === rowStyle) ?? ROW_STYLES[0];
  return (
    <Section>
      <Group>
        <PickerRow
          title="Theme"
          value={`${themeDef(theme).label}, ${accentDef(accent).label}`}
          accessibilityHint="Opens the theme, accent and terminal colors"
          onPress={() => router.push("/theme" as never) /* typed routes regenerate on the next dev start */}
        />
        <Row
          title="Top of the Agents tab"
          detail={top.detail}
          below={
            <Segmented<HomeTop>
              options={HOME_TOPS.map((o) => ({ id: o.id, label: o.label }))}
              value={homeTop}
              onChange={setHomeTop}
              label="Top of the Agents tab"
            />
          }
        />
        <Row
          title="Agent list style"
          detail={`${style.label}: ${style.detail}`}
          below={
            <Segmented<RowStyle>
              options={ROW_STYLES.map((o) => ({ id: o.id, label: ROW_STYLE_SEGMENTS[o.id] }))}
              value={rowStyle}
              onChange={setRowStyle}
              label="Agent list style"
            />
          }
        />
      </Group>
    </Section>
  );
}
