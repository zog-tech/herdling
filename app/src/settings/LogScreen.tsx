import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { Check, Copy, Trash2, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import * as haptics from "@/ui/haptics";

import { IconButton } from "@/ui/IconButton";

/**
 * The skeleton of the three log screens (design rule 4): the native header with Copy (and Clear
 * when the log can be cleared) as icon buttons, the entries in `Screen`, and a centered empty state.
 * Copy puts the whole log on the clipboard and shows a check until the log changes.
 */
export function LogScreen({
  empty,
  EmptyIcon,
  count,
  copyText,
  onClear,
  children,
}: {
  /** The sentence of the empty state. */
  empty: string;
  EmptyIcon: LucideIcon;
  count: number;
  /** The whole log as text, made when the user taps Copy. */
  copyText: () => string;
  /** Clears the log. Without it there is no Clear button. */
  onClear?: () => void;
  children: ReactNode;
}) {
  const [copiedAt, setCopiedAt] = useState<number>();
  const copied = copiedAt === count;
  const copy = () => {
    haptics.tap();
    Clipboard.setStringAsync(copyText()).then(
      () => setCopiedAt(count),
      () => haptics.fail(),
    );
  };
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <IconButton
                size="header"
                label={copied ? "Copied" : "Copy"}
                Icon={copied ? Check : Copy}
                color={copied ? colors.status.done : colors.text}
                disabled={count === 0}
                onPress={copy}
              />
              {onClear ? (
                <IconButton
                  size="header"
                  label="Clear"
                  Icon={Trash2}
                  disabled={count === 0}
                  onPress={() => {
                    haptics.tap();
                    setCopiedAt(undefined);
                    onClear();
                  }}
                />
              ) : null}
            </View>
          ),
        }}
      />
      <Screen>
        {count === 0 ? (
          <StateNotice Icon={EmptyIcon} message={empty} />
        ) : (
          children
        )}
      </Screen>
    </>
  );
}
