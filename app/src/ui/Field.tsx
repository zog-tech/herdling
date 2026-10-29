import { TextInput, View, type TextInputProps } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "./Text";

type Props = TextInputProps & { label: string; mono?: boolean };

/** Labeled text input, 44pt high. */
export function Field({ label, mono, style, ...rest }: Props) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" muted>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={colors.accent}
        {...rest}
        style={[
          {
            minHeight: hitTarget,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.muted,
            color: colors.text,
            fontSize: type.size.body,
            fontFamily: mono ? fontFamily.mono : undefined,
          },
          style,
        ]}
      />
    </View>
  );
}
