import { Check, ChevronDown, ChevronRight, CircleX, Loader, Wrench } from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { HScrollView } from "../HScrollView";

type Result = { ok: boolean; text: string; truncated: boolean };

const MAX_INPUT_CHARS = 4000;

function inputText(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  return s.length > MAX_INPUT_CHARS ? `${s.slice(0, MAX_INPUT_CHARS)}\n…` : s;
}

function Block({ label, text, color }: { label: string; text: string; color?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <HScrollView showsHorizontalScrollIndicator={false} style={{ backgroundColor: colors.bg, borderRadius: radius.sm }}>
        <Text
          selectable
          style={{
            fontFamily: fontFamily.mono,
            fontSize: type.size.caption,
            lineHeight: 18,
            color: color ?? colors.text,
            padding: space.sm,
          }}
        >
          {text}
        </Text>
      </HScrollView>
    </View>
  );
}

/** One tool call: collapsed to `Name · summary`; tap shows input and result. */
export const ToolCard = memo(function ToolCard({
  name,
  inputSummary,
  input,
  result,
}: {
  name: string;
  inputSummary: string;
  input: unknown;
  result?: Result;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const state = !result ? "running" : result.ok ? "ok" : "failed";
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.muted, backgroundColor: colors.card }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} ${inputSummary}, ${state}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          minHeight: hitTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Wrench size={14} color={colors.textMuted} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fontFamily.mono, fontSize: type.size.small - 1 }}>
          <Text style={{ fontFamily: fontFamily.monoBold, fontSize: type.size.small - 1 }}>{name}</Text>
          {inputSummary ? <Text muted style={{ fontFamily: fontFamily.mono, fontSize: type.size.small - 1 }}>{` · ${inputSummary}`}</Text> : null}
        </Text>
        {state === "ok" ? (
          <Check size={14} color={colors.status.done} />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {state === "failed" ? (
              <CircleX size={14} color={colors.danger} />
            ) : (
              <Loader size={14} color={colors.status.working} />
            )}
            <Text variant="caption" bold color={state === "failed" ? colors.danger : colors.status.working}>
              {state === "failed" ? "Failed" : "Running"}
            </Text>
          </View>
        )}
        <Chevron size={14} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
          <Block label="Input" text={inputText(input) || "(none)"} />
          {result ? (
            <Block
              label={result.ok ? (result.truncated ? "Result (truncated)" : "Result") : "Error"}
              text={result.text || "(empty)"}
              color={result.ok ? undefined : colors.danger}
            />
          ) : (
            <Text variant="caption" muted>
              Running…
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
});
