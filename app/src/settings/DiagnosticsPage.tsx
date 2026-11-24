import { useRouter } from "expo-router";
import { Bug, Keyboard as KeyboardIcon, MessageSquareText } from "lucide-react-native";

import { colors, icon } from "@/theme/tokens";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

/**
 * More, "Diagnostics": the three logs that stay on this phone. Use them when a reply stays silent,
 * the keyboard covers the prompt box, or the app closed.
 */
export function DiagnosticsPage() {
  const router = useRouter();
  const iconProps = { size: icon.md, color: colors.textMuted, strokeWidth: icon.strokeWidth };
  return (
    <Screen flush>
      <Section footer="The logs stay on this phone. Nothing goes to a server.">
        <Group>
          <Row
            accessibilityLabel="Speech log"
            onPress={() => router.push("/speech-log" as never) /* typed routes regenerate on the next dev start */}
            leading={<MessageSquareText {...iconProps} />}
            title="Speech log"
            detail="The last 20 speech and voice input events. Use it when a reply stays silent."
            chevron
          />
          <Row
            accessibilityLabel="Display log"
            onPress={() => router.push("/display-log" as never)}
            leading={<KeyboardIcon {...iconProps} />}
            title="Display log"
            detail="The last 30 keyboard events and picker errors. Use it when the keyboard covers the prompt box."
            chevron
          />
          <Row
            accessibilityLabel="Crash log"
            onPress={() => router.push("/crash-log" as never)}
            leading={<Bug {...iconProps} />}
            title="Crash log"
            detail="The last 5 errors that closed the app or showed an error screen. It stays on this phone."
            chevron
          />
        </Group>
      </Section>
    </Screen>
  );
}
