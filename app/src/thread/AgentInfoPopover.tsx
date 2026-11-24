/**
 * The small card that drops down from the session title: the agent (mark and product name) and the
 * model it uses now. Claude Code also gets "Change model", which opens the model sheet. The rows
 * have the menu row look (`MenuRow` of `ui/MenuSheet`) on the card surface with the top highlight.
 * With no known model (an older herdlingd, or no reply yet) the model row is left out.
 * A plain fade-in `Modal`, so it shows over the native header on iOS and Android. A tap outside closes it.
 */
import { Cpu, Replace } from "lucide-react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { colors, denseScale, elevation, icon, radius, sheet, space } from "@/theme/tokens";
import { AgentMark } from "@/ui/AgentMark";
import { Divider } from "@/ui/Group";
import { MenuRow } from "@/ui/MenuSheet";
import { Text } from "@/ui/Text";
import { TopHighlight } from "@/ui/TopHighlight";

import { modelLabel } from "./modelLabel";

/** Where the title is on the screen (`measureInWindow`). */
export type Anchor = { x: number; y: number; width: number; height: number };

const CARD_WIDTH = 264;

/** The left edge of the card: under the anchor, inside the screen. */
export function cardLeft(anchor: Anchor, screenWidth: number, width = CARD_WIDTH): number {
  const max = Math.max(space.md, screenWidth - width - space.md);
  return Math.min(Math.max(anchor.x, space.md), max);
}

export function AgentInfoPopover({
  visible,
  anchor,
  kind,
  model,
  onClose,
  onChangeModel,
}: {
  visible: boolean;
  anchor: Anchor | undefined;
  kind: string;
  /** The raw model value (`claude-opus-5-5`), or undefined when unknown. */
  model: string | undefined;
  onClose: () => void;
  /** Set for an agent with a model switch (Claude Code). */
  onChangeModel?: () => void;
}) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const label = modelLabel(model);
  const top = anchor ? anchor.y + anchor.height + space.xs : space.xxxl * 2;
  const left = anchor ? cardLeft(anchor, width) : space.md;
  return (
    <Modal visible={visible} transparent animationType={reduced ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }}>
        <View
          // A tap on the card does not close it.
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
          style={{
            position: "absolute",
            top,
            left,
            width: Math.min(CARD_WIDTH, width - space.md * 2),
            ...elevation[1],
            borderRadius: radius.lg,
            overflow: "hidden",
          }}
        >
          <TopHighlight inset={radius.lg} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }}>
            <AgentMark kind={kind} size={icon.lg} />
            <Text variant="headline" numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flexShrink: 1 }}>
              {agentLabel(kind)}
            </Text>
          </View>
          {label ? (
            <>
              <Divider />
              {/* The menu row look, not a button: the model name as the value at the right. */}
              <View
                accessible
                accessibilityLabel={`Model: ${label}`}
                style={{ minHeight: sheet.rowHeight, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm }}
              >
                <Cpu size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text>Model</Text>
                  {model && model !== label ? (
                    <Text variant="caption" muted mono numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
                      {model}
                    </Text>
                  ) : null}
                </View>
                <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
                  {label}
                </Text>
              </View>
            </>
          ) : null}
          {onChangeModel ? (
            <>
              <Divider />
              <MenuRow item={{ label: "Change model", Icon: Replace }} onPress={onChangeModel} />
            </>
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}
