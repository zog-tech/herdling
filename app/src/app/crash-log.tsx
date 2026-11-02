import * as Clipboard from "expo-clipboard";
import { Copy, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { clearCrashLog, crashLogText, crashTime, loadCrashLog, useCrashLog } from "@/crash/crashLog";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";

/**
 * The last JavaScript errors, newest first: the time, the message, the route, the update and the
 * stack. The text is selectable; Copy puts all of it on the clipboard. Nothing goes to a server.
 */
export default function CrashLogScreen() {
  const entries = useCrashLog((s) => s.entries);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    loadCrashLog();
  }, []);
  const newest = [...entries].reverse();
  return (
    <Screen>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Button
            label={copied ? "Copied" : "Copy"}
            Icon={Copy}
            variant="secondary"
            disabled={entries.length === 0}
            onPress={() => {
              haptics.tap();
              Clipboard.setStringAsync(crashLogText(entries)).then(() => setCopied(true), () => {});
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Clear"
            Icon={Trash2}
            variant="secondary"
            disabled={entries.length === 0}
            onPress={() => {
              haptics.tap();
              setCopied(false);
              void clearCrashLog();
            }}
          />
        </View>
      </View>
      {newest.length === 0 ? (
        <Text muted>No errors saved.</Text>
      ) : (
        newest.map((e, i) => (
          <View key={`${e.time}-${i}`} style={{ gap: space.xs }}>
            <Text bold>{`${crashTime(e.time)} · ${e.kind === "fatal" ? "Closed the app" : "Caught by an error screen"}`}</Text>
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
        ))
      )}
    </Screen>
  );
}
