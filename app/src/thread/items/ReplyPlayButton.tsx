import { Square, Volume2 } from "lucide-react-native";
import { Pressable } from "react-native";

import { colors, hitTarget, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { speakReplyNow, useManualSpeech } from "@/voice/useSpeakReplies";

/**
 * Speaks one reply on tap, whatever the session speaker toggle says. A second tap while it speaks stops it.
 * `id` is the thread item id; it tells which reply speaks now.
 */
export function ReplyPlayButton({ hostId, id, markdown }: { hostId: string; id: string; markdown: string }) {
  const speaking = useManualSpeech((s) => s.key === id);
  const Icon = speaking ? Square : Volume2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={speaking ? "Stop reading reply" : "Read reply aloud"}
      onPress={() => {
        haptics.tap();
        void speakReplyNow(hostId, markdown, id);
      }}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        alignItems: "flex-start",
        justifyContent: "center",
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <Icon size={18} color={speaking ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}
