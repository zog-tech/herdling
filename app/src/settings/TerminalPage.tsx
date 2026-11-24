import { useRouter } from "expo-router";

import { useCustomKeys } from "@/terminal/customKeys";
import { useTerminalRenderer } from "@/terminal/renderer";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";

const RENDERERS = [
  { id: "terminal", label: "Terminal" },
  { id: "classic", label: "Classic" },
] as const;

/**
 * More, "Terminal": the renderer of the terminal view, and the custom keys and text macros of the
 * key bar. The terminal theme is in Appearance, Theme.
 */
export function TerminalPage() {
  const router = useRouter();
  const count = useCustomKeys((s) => s.keys.length);
  const renderer = useTerminalRenderer((s) => s.renderer);
  const setRenderer = useTerminalRenderer((s) => s.set);
  return (
    <Screen flush>
      <Section>
        <Group>
          <Row
            title="Renderer"
            detail={
              renderer === "terminal"
                ? "A real terminal: exact grid, cursor and full-screen apps. Needs herdlingd 0.2.0 or later; else Classic."
                : "Screen text with colors, as in earlier versions."
            }
            below={<Segmented options={RENDERERS} value={renderer} onChange={setRenderer} label="Terminal renderer" />}
          />
          <Row
            accessibilityLabel={`Key bar, ${count} custom keys`}
            onPress={() => router.push("/key-bar" as never) /* typed routes regenerate on the next dev start */}
            title="Key bar"
            detail="Custom keys and text macros such as /new or yes."
            trailing={
              <Text muted style={{ fontVariant: ["tabular-nums"] }}>
                {count}
              </Text>
            }
            chevron
          />
        </Group>
      </Section>
    </Screen>
  );
}
