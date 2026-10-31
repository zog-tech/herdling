import { ArrowRightToLine, Folder, FolderGit2, TriangleAlert } from "lucide-react-native";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, icon, radius, space, state, textRole } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import type { Suggestion } from "./autocomplete";

/**
 * The editable path of New session, in JetBrains Mono. Typing shows matching sub-folders under
 * the field; a tap on one opens it. The end button completes the typed name as far as the
 * matches agree (the Tab key of a shell). "Go" on the keyboard opens the typed path.
 */
export function PathField({
  value,
  onChangeText,
  onSubmit,
  suggestions,
  onPick,
  onComplete,
  error,
  editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
  /** Set when a completion can add text. */
  onComplete?: () => void;
  error?: string;
  editable?: boolean;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: hitTarget,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          backgroundColor: colors.raised,
          paddingLeft: space.md,
        }}
      >
        <TextInput
          accessibilityLabel="Folder path"
          accessibilityHint="Type a path. Matching folders show below."
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          editable={editable}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          // The keyboard stays open after "Go", so the next path can be typed at once.
          submitBehavior="submit"
          placeholder="~/path/to/folder"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          maxFontSizeMultiplier={textRole.mono.maxScale}
          style={{
            flex: 1,
            minHeight: hitTarget,
            color: colors.text,
            fontFamily: fontFamily.mono,
            fontSize: textRole.mono.size,
            paddingVertical: space.sm,
          }}
        />
        {onComplete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Complete the folder name"
            onPress={onComplete}
            style={({ pressed }) => ({
              width: hitTarget,
              height: hitTarget,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? state.pressedOpacity : 1,
            })}
          >
            <ArrowRightToLine size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <TriangleAlert size={icon.sm} color={colors.danger} />
          <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
      {suggestions.length > 0 ? (
        <View
          accessibilityLabel="Matching folders"
          style={{ borderRadius: radius.md, backgroundColor: colors.card, overflow: "hidden" }}
        >
          {suggestions.map((s, i) => {
            const Icon = s.git ? FolderGit2 : Folder;
            return (
              <Pressable
                key={s.path}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.name}${s.git ? ", git repository" : ""}`}
                onPress={() => onPick(s)}
                style={({ pressed }) => ({
                  minHeight: hitTarget,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingHorizontal: space.md,
                  borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
                  borderColor: colors.divider,
                  backgroundColor: pressed ? colors.raised : "transparent",
                })}
              >
                <Icon size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
                <Text mono numberOfLines={1} style={{ flex: 1 }}>
                  {s.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
