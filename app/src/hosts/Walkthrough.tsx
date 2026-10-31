import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import type { Step } from "./steps";

/** A command in mono text with a copy button. */
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        backgroundColor: colors.sunken,
        borderRadius: radius.sm,
        paddingLeft: space.md,
      }}
    >
      <Text variant="caption" mono selectable style={{ flex: 1, paddingVertical: space.sm }}>
        {command}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : `Copy ${command}`}
        onPress={async () => {
          await Clipboard.setStringAsync(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={({ pressed }) => ({
          minWidth: hitTarget,
          minHeight: hitTarget,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? state.pressedOpacity : 1,
        })}
      >
        {copied ? (
          <Check size={icon.sm} color={colors.status.done} strokeWidth={icon.strokeWidth} />
        ) : (
          <Copy size={icon.sm} color={colors.text} strokeWidth={icon.strokeWidth} />
        )}
      </Pressable>
    </View>
  );
}

/** Numbered steps, one action each. A step with a command shows it with a copy button. */
export function Walkthrough({ steps, start = 1 }: { steps: Step[]; start?: number }) {
  return (
    <View style={{ gap: space.md }}>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", gap: space.md }} accessible={!s.command}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: radius.pill,
              backgroundColor: colors.raised,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text variant="caption" bold accessibilityLabel={`Step ${start + i}`}>
              {start + i}
            </Text>
          </View>
          <View style={{ flex: 1, gap: space.sm }}>
            <Text variant="small">{s.text}</Text>
            {s.command ? <CommandLine command={s.command} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}
