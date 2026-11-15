/**
 * The pages of a tab in the session screen: a strip with one dot per pane of the tab (the current
 * one filled), a swipe on the strip to the previous or next pane, and a tab map button that opens
 * a sheet with every pane of the tab. Hidden when the tab has one pane (`tabPanes` gives null).
 */
import { LayoutGrid } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { pageTarget, type TabPane, type TabPanes } from "@/herdr/tabPanes";
import { colors, denseScale, dot, hitTarget, icon, radius, space } from "@/theme/tokens";
import { AgentMark } from "@/ui/AgentMark";
import { CloseButton } from "@/ui/CloseButton";
import * as haptics from "@/ui/haptics";
import { StatusDot } from "@/ui/StatusDot";
import { statusMeta } from "@/ui/StatusIcon";
import { TerminalMark } from "@/ui/TerminalMark";
import { Text } from "@/ui/Text";

const SWIPE_DISTANCE = 40;
const SWIPE_VELOCITY = 500;

/** One tile of the tab map: the mark, the title and the state. The open pane has the selected edge. */
function PaneTile({ p, current, onPress }: { p: TabPane; current: boolean; onPress: () => void }) {
  const meta = p.status ? statusMeta(p.status) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${p.title}${meta ? `, ${meta.label}` : ", terminal"}${current ? ", open now" : ""}`}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        minHeight: hitTarget * 2,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.md,
        borderWidth: current ? 2 : 1,
        borderColor: current ? colors.accent : p.status === "blocked" ? colors.status.blocked : colors.edge,
        backgroundColor: p.status === "blocked" ? colors.blockedTint : pressed ? colors.raised : colors.card,
      })}
    >
      {p.terminal ? <TerminalMark size={24} /> : <AgentMark kind={p.kind} size={24} />}
      <Text bold numberOfLines={2} maxFontSizeMultiplier={denseScale.row}>
        {p.title}
      </Text>
      {meta ? <StatusDot label={meta.label} color={meta.color} lit={p.status === "working"} /> : <Text variant="caption" muted>Terminal</Text>}
    </Pressable>
  );
}

/** The tab map: every pane of the tab as a tile, in tab order. A tap opens that pane. */
function TabMap({ tab, visible, onClose, onOpen }: { tab: TabPanes; visible: boolean; onClose: () => void; onOpen: (paneId: string) => void }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType={reduced ? "fade" : "slide"} presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.md, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg }}>
          <Text variant="title" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
            {tab.tabLabel ? `Tab ${tab.tabLabel}` : "This tab"}
          </Text>
          <CloseButton onPress={onClose} />
        </View>
        <Text variant="caption" muted style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {`${tab.panes.length} panes, in tab order`}
        </Text>
        <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, padding: space.lg }}>
          {tab.panes.map((p, i) => (
            <PaneTile
              key={p.pane_id}
              p={p}
              current={i === tab.index}
              onPress={() => {
                haptics.tap();
                onClose();
                if (i !== tab.index) onOpen(p.pane_id);
              }}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function PanePager({ tab, onOpen }: { tab: TabPanes; onOpen: (paneId: string) => void }) {
  const [mapOpen, setMapOpen] = useState(false);
  const go = (step: -1 | 1) => {
    const target = pageTarget(tab, step);
    if (!target) return;
    haptics.tap();
    onOpen(target);
  };
  const gesture = usePanGesture({
    activeOffsetX: [-15, 15],
    failOffsetY: [-15, 15],
    onDeactivate: (e) => {
      const far = Math.abs(e.translationX) > SWIPE_DISTANCE || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (!e.canceled && far) scheduleOnRN(go, e.translationX < 0 ? 1 : -1);
    },
  });
  const current = tab.panes[tab.index];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: space.lg, paddingRight: space.xs }}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Pane ${tab.index + 1} of ${tab.panes.length}${tab.tabLabel ? ` in tab ${tab.tabLabel}` : ""}`}
          accessibilityValue={{ text: current?.title }}
          accessibilityHint="Swipe left or right for the other panes of this tab"
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => go(e.nativeEvent.actionName === "increment" ? 1 : -1)}
          style={{ flex: 1, minHeight: hitTarget, flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 2 }}>
            {tab.panes.map((p, i) => (
              <Pressable
                key={p.pane_id}
                importantForAccessibility="no"
                hitSlop={space.sm}
                onPress={() => {
                  if (i === tab.index) return;
                  haptics.tap();
                  onOpen(p.pane_id);
                }}
                style={{
                  width: dot.size,
                  height: dot.size,
                  borderRadius: dot.size / 2,
                  backgroundColor: i === tab.index ? colors.text : p.status === "blocked" ? colors.status.blocked : colors.divider,
                }}
              />
            ))}
          </View>
          <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flex: 1 }}>
            {tab.tabLabel ? `${tab.tabLabel} · ${tab.index + 1} of ${tab.panes.length}` : `${tab.index + 1} of ${tab.panes.length}`}
          </Text>
        </View>
      </GestureDetector>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tab map"
        accessibilityHint="Shows every pane of this tab"
        onPress={() => {
          haptics.tap();
          setMapOpen(true);
        }}
        style={{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" }}
      >
        <LayoutGrid size={icon.md} color={colors.text} />
      </Pressable>
      <TabMap tab={tab} visible={mapOpen} onClose={() => setMapOpen(false)} onOpen={onOpen} />
    </View>
  );
}
