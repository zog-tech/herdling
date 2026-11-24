import { Bug } from "lucide-react-native";
import { useEffect } from "react";
import { View } from "react-native";

import { clearCrashLog, crashKindLabel, crashLogText, crashTime, loadCrashLog, useCrashLog } from "@/crash/crashLog";
import { LogScreen } from "@/settings/LogScreen";
import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/**
 * The last JavaScript errors and native crashes, newest first: the time, the message, the route, the update and the
 * stack. The text is selectable; Copy and Clear are in the header. Nothing goes to a server.
 */
export default function CrashLogScreen() {
  const entries = useCrashLog((s) => s.entries);
  useEffect(() => {
    loadCrashLog();
  }, []);
  const newest = [...entries].reverse();
  return (
    <LogScreen
      empty="No errors saved."
      EmptyIcon={Bug}
      count={entries.length}
      copyText={() => crashLogText(entries)}
      onClear={() => void clearCrashLog()}
    >
      {newest.map((e, i) => (
        <View key={`${e.time}-${i}`} style={{ gap: space.xs }}>
          <Text bold>{`${crashTime(e.time)} · ${crashKindLabel(e.kind)}`}</Text>
          <Text selectable>{e.message}</Text>
          {e.route || e.update ? (
            <Text variant="caption" muted selectable>
              {[e.route ? `Route ${e.route}` : undefined, e.update ? `Update ${e.update}` : undefined].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {e.stack ? (
            <Text selectable mono variant="small" style={{ color: colors.textMuted }}>
              {e.stack}
            </Text>
          ) : null}
        </View>
      ))}
    </LogScreen>
  );
}
