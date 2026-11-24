import { Keyboard as KeyboardIcon } from "lucide-react-native";

import { LogScreen } from "@/settings/LogScreen";
import { colors, space } from "@/theme/tokens";
import { displayLogText, useDisplayLog } from "@/ui/displayLog";
import { Text } from "@/ui/Text";
import { logTime } from "@/voice/speechLog";

/** The last keyboard events and picker failures, newest first. Copy in the header puts all of it on the clipboard. */
export default function DisplayLogScreen() {
  const events = useDisplayLog((s) => s.events);
  const newest = [...events].reverse();
  return (
    <LogScreen empty="No keyboard or picker events yet." EmptyIcon={KeyboardIcon} count={events.length} copyText={() => displayLogText(events)}>
      {newest.map((e, i) => (
        <Text key={`${e.at}-${i}`} selectable mono variant="small" style={{ color: colors.text, paddingVertical: space.xs }}>
          {logTime(e.at)} {e.text}
        </Text>
      ))}
    </LogScreen>
  );
}
