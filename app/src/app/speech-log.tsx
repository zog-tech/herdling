import { AudioLines } from "lucide-react-native";

import { LogScreen } from "@/settings/LogScreen";
import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { logTime, speechLogText, useSpeechLog } from "@/voice/speechLog";

/** The last speech events, newest first. The text is selectable; Copy in the header puts all of it on the clipboard. */
export default function SpeechLogScreen() {
  const events = useSpeechLog((s) => s.events);
  const newest = [...events].reverse();
  return (
    <LogScreen empty="No speech events yet." EmptyIcon={AudioLines} count={events.length} copyText={() => speechLogText(events)}>
      {newest.map((e, i) => (
        <Text key={`${e.at}-${i}`} selectable mono variant="small" style={{ color: colors.text, paddingVertical: space.xs }}>
          {logTime(e.at)} {e.text}
        </Text>
      ))}
    </LogScreen>
  );
}
