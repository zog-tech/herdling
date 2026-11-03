import * as Clipboard from "expo-clipboard";
import { Copy } from "lucide-react-native";
import { useState } from "react";

import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { displayLogText, useDisplayLog } from "@/ui/displayLog";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";
import { logTime } from "@/voice/speechLog";

/** The last keyboard events and picker failures, newest first. Copy puts all of it on the clipboard. */
export default function DisplayLogScreen() {
  const events = useDisplayLog((s) => s.events);
  const [copied, setCopied] = useState(false);
  const newest = [...events].reverse();
  return (
    <Screen>
      <Button
        label={copied ? "Copied" : "Copy"}
        Icon={Copy}
        variant="secondary"
        onPress={() => {
          haptics.tap();
          Clipboard.setStringAsync(displayLogText(events)).then(() => setCopied(true), () => {});
        }}
      />
      {newest.length === 0 ? (
        <Text muted>No keyboard or picker events yet.</Text>
      ) : (
        newest.map((e, i) => (
          <Text key={`${e.at}-${i}`} selectable mono variant="small" style={{ color: colors.text, paddingVertical: space.xs }}>
            {logTime(e.at)} {e.text}
          </Text>
        ))
      )}
    </Screen>
  );
}
