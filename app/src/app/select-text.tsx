import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { Copy } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, hitTarget, icon, space, state, type } from "@/theme/tokens";
import { useSelectText } from "@/thread/selectText";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

const LINE = Math.round(type.size.body * type.lineHeight.body);

/** Copy all of the text from the header. The label says "Copied" for a short time. */
function CopyAll({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : "Copy all"}
      onPress={() => {
        Clipboard.setStringAsync(text).then(
          () => {
            haptics.commit();
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => haptics.fail(),
        );
      }}
      style={({ pressed }) => ({ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? state.pressedOpacity : 1 })}
    >
      <Copy size={icon.md} color={copied ? colors.status.done : colors.text} />
    </Pressable>
  );
}

/**
 * "Select text" from the long-press menu of a thread row: the full message, so the user can select
 * and copy a part of it with the system handles and menu (Copy, Look Up, Share).
 * iOS: a read-only multiline TextInput. A `selectable` Text on iOS copies only all of the text, but a
 * non-editable text view keeps range selection. Android: a `selectable` Text, which has handles; a
 * TextInput with `editable={false}` is disabled there and cannot select.
 */
export default function SelectTextScreen() {
  const insets = useSafeAreaInsets();
  const view = useSelectText((s) => s.current);
  const text = view?.text ?? "";
  const textStyle = { color: colors.text, fontSize: type.size.body, lineHeight: LINE };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: view?.title ?? "Select text", headerRight: () => <CopyAll text={text} /> }} />
      {Platform.OS === "ios" ? (
        <TextInput
          value={text}
          editable={false}
          multiline
          scrollEnabled
          selectionColor={colors.accent}
          accessibilityLabel={view?.title ?? "Message"}
          style={[
            textStyle,
            { flex: 1, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: insets.bottom + space.lg, textAlignVertical: "top" },
          ]}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.lg }}>
          <Text selectable selectionColor={colors.accent} style={textStyle}>
            {text}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
