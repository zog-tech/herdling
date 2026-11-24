import { Check } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { scheduleOnRN } from "react-native-worklets";
import { create } from "zustand";

import { colors, denseScale, icon, motion, radius, sheet, space, state } from "@/theme/tokens";

import { CloseButton } from "./CloseButton";
import { Group } from "./Group";
import { SearchField } from "./SearchField";
import * as haptics from "./haptics";
import { useKeyboardHeight } from "./KeyboardAvoider";
import { initialMenuState, menuReducer, type MenuEffect, type MenuEvent, type MenuState } from "./menuMachine";
import { arrangeSections, filterSections, sheetLift, sheetMaxHeight, swipeCloses, type MenuItem, type MenuSection, type MenuSpec } from "./menuRules";
import { Text } from "./Text";
import { TopHighlight } from "./TopHighlight";

/**
 * The one menu of the app: a bottom sheet in the app's own style (design rule 3). It replaces the
 * system action sheet on iOS and the old Android sheet.
 *
 * Use:
 *
 * ```tsx
 * showMenu({
 *   title: "api",
 *   detail: "studio.local · Claude Code",
 *   sections: [
 *     { title: "This session", items: [{ label: "Rename", Icon: Pencil, onPick: rename }] },
 *     { items: [{ label: "Close", Icon: X, destructive: true, onPick: close }] },
 *   ],
 * });
 * ```
 *
 * - Mount `MenuSheetHost` once, in the root layout. It draws over every screen, also over a modal
 *   or a form sheet: on iOS in a `FullWindowOverlay` (a layer on top of the window, so it needs no
 *   presented view controller, which the root cannot present over a native modal), on Android in a
 *   React Native `Modal` (an own dialog window).
 * - No "Cancel" row. The sheet closes with a tap outside, a swipe down, the close button, the
 *   Android back button and the VoiceOver escape gesture. Then `onClose` runs.
 * - Destructive rows always go to the last section. The caller still asks for a confirm first.
 * - `onPick` runs after the sheet is gone, so it can open a screen or a second sheet.
 * - One sheet at a time: a new `showMenu` replaces the open one (the old one gets `onClose`).
 * - Motion: it enters in `motion.enterMs` and leaves in 65 % of that; a swipe ends in a spring
 *   with the finger's speed. Reduce Motion: fade only. Haptics: `press()` on open, `tap()` on a pick.
 * - The keyboard can stay up: the sheet rises above it. Rows grow with the text size; above 80 % of
 *   the screen the rows scroll.
 *
 * The rules are in `menuRules.ts` and the life of the sheet in `menuMachine.ts`.
 */

export type { MenuItem, MenuSection, MenuSpec } from "./menuRules";

type Store = { state: MenuState };

/** The state of the one menu sheet. Read it in tests; change it only with `showMenu` and `closeMenu`. */
export const useMenuSheet = create<Store>(() => ({ state: initialMenuState }));

function runEffect(e: MenuEffect) {
  if (e.kind === "haptic") {
    if (e.feel === "press") haptics.press();
    else haptics.tap();
    return;
  }
  if (e.outcome.kind === "pick") e.outcome.item.onPick();
  else e.menu.onClose?.();
}

/** Sends one event to the menu machine and runs its effects after the new state is in place. */
function send(event: MenuEvent) {
  const { state: next, effects } = menuReducer(useMenuSheet.getState().state, event);
  useMenuSheet.setState({ state: next });
  effects.forEach(runEffect);
}

/** Opens the menu sheet. A menu with no rows does not open. */
export function showMenu(menu: MenuSpec): void {
  const sections = arrangeSections(menu.sections);
  if (sections.length === 0) return;
  send({ type: "show", menu: { ...menu, sections } });
}

/** Closes the open menu with no pick (its `onClose` runs). Does nothing when no menu is open. */
export function closeMenu(): void {
  send({ type: "cancel" });
}

const EASE_OUT = Easing.bezier(...motion.ease.out);
const EXIT_MS = Math.round(motion.enterMs * motion.exitRatio);

/**
 * Draws the menu of `showMenu`. Mount it once, in the root layout.
 */
export function MenuSheetHost() {
  const st = useMenuSheet((s) => s.state);
  const visible = st.kind === "open" || st.kind === "leaving";

  // The layer is gone from the screen: run the outcome in the next task, after the native views
  // are removed, so that the action can present a screen.
  useEffect(() => {
    if (st.kind !== "hiding") return;
    const gen = st.gen;
    const t = setTimeout(() => send({ type: "dismissed", gen }), 0);
    return () => clearTimeout(t);
  }, [st]);

  const content =
    st.kind === "open" || st.kind === "leaving" ? (
      <SheetView key={st.gen} menu={st.menu} gen={st.gen} leaving={st.kind === "leaving"} byGesture={st.kind === "leaving" && st.byGesture} />
    ) : null;

  if (Platform.OS === "ios") {
    return visible ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{content}</FullWindowOverlay> : null;
  }
  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => send({ type: "cancel" })}>
      {content}
    </Modal>
  );
}

function SheetView({ menu, gen, leaving, byGesture }: { menu: MenuSpec; gen: number; leaving: boolean; byGesture: boolean }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const [rootHeight, setRootHeight] = useState(win.height);
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [query, setQuery] = useState("");

  const lift = sheetLift(rootHeight, keyboard, win.height);
  const maxHeight = sheetMaxHeight({ rootHeight, lift, topInset: insets.top });
  const scrollable = content > viewport + 1;
  const sections = menu.search ? filterSections(menu.sections, query) : menu.sections;
  const anyCheck = menu.sections.some((s) => s.items.some((i) => i.checked !== undefined));

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const height = useSharedValue(win.height);

  useEffect(() => {
    progress.set(withTiming(1, { duration: motion.enterMs, easing: EASE_OUT }));
  }, [progress]);

  // Leaving: the sheet moves out (a swipe already started its own spring), then the window hides.
  useEffect(() => {
    if (!leaving) return;
    if (!byGesture) progress.set(withTiming(0, { duration: EXIT_MS, easing: EASE_OUT }));
    const t = setTimeout(() => send({ type: "exitDone", gen }), byGesture ? motion.spring.sheet.duration : EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving, byGesture, gen, progress]);

  const onSwiped = () => send({ type: "swiped" });
  const pan = usePanGesture({
    activeOffsetY: sheet.dragStart,
    failOffsetX: [-sheet.sideSlop, sheet.sideSlop],
    onUpdate: (e) => {
      drag.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      if (swipeCloses(e.translationY, e.velocityY, height.get())) {
        // Reduce Motion: no slide, the sheet fades out where the finger left it.
        if (reduced) progress.set(withTiming(0, { duration: EXIT_MS, easing: EASE_OUT }));
        else drag.set(withSpring(height.get(), { ...motion.spring.sheet, velocity: e.velocityY }));
        scheduleOnRN(onSwiped);
      } else {
        drag.set(withSpring(0, { ...motion.spring.sheet, velocity: e.velocityY }));
      }
    },
  });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheetStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: progress.get(), transform: [{ translateY: drag.get() }] }
      : { transform: [{ translateY: (1 - progress.get()) * height.get() + drag.get() }] },
  );

  const cancel = () => send({ type: "cancel" });
  const pick = (item: MenuItem) => send({ type: "pick", item });

  const header = (
    <View>
      <View style={{ alignItems: "center", paddingTop: space.sm }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={{ width: sheet.grabber.width, height: sheet.grabber.height, borderRadius: radius.pill, backgroundColor: colors.edge }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.xs }}>
        <View style={{ flex: 1, gap: 2, paddingVertical: menu.title || menu.detail ? space.sm : 0 }}>
          {menu.title ? (
            <Text variant="headline" accessibilityRole="header">
              {menu.title}
            </Text>
          ) : null}
          {menu.detail ? (
            <Text variant="small" muted>
              {menu.detail}
            </Text>
          ) : null}
        </View>
        <CloseButton onPress={cancel} />
      </View>
      {menu.search ? (
        <SearchField value={query} onChangeText={setQuery} placeholder={menu.search.placeholder ?? "Search"} style={{ marginHorizontal: space.lg, marginTop: space.xs }} />
      ) : null}
    </View>
  );

  const body = (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={{ gap: space.md, paddingTop: space.sm }}
      scrollEnabled={scrollable}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
      onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
      onContentSizeChange={(_w, h) => setContent(h)}
    >
      {sections.map((s, si) => (
        <MenuGroup key={`${si}-${s.title ?? ""}`} section={s} onPick={pick} selectable={anyCheck} />
      ))}
      {sections.length === 0 ? (
        <Text muted accessibilityLiveRegion="polite" style={{ textAlign: "center", paddingVertical: space.xl, paddingHorizontal: space.lg }}>
          No match.
        </Text>
      ) : null}
    </ScrollView>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View
        style={{ flex: 1, justifyContent: "flex-end" }}
        onLayout={(e) => setRootHeight(e.nativeEvent.layout.height)}
        accessibilityViewIsModal
        onAccessibilityEscape={cancel}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]} />
        {/* A tap outside closes. VoiceOver uses the close button or the escape gesture instead. */}
        <Pressable
          testID="menu-scrim"
          onPress={cancel}
          accessible={false}
          importantForAccessibility="no"
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityLabel={menu.title ? undefined : (menu.accessibilityLabel ?? "Menu")}
          onLayout={(e) => height.set(e.nativeEvent.layout.height)}
          style={[
            {
              maxHeight,
              marginBottom: lift,
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              // Over the keyboard there is no home indicator to clear.
              paddingBottom: (lift > 0 ? 0 : insets.bottom) + space.sm,
              paddingLeft: insets.left,
              paddingRight: insets.right,
            },
            sheetStyle,
          ]}
        >
          <TopHighlight inset={radius.lg} />
          {scrollable ? (
            <>
              <GestureDetector gesture={pan}>{header}</GestureDetector>
              {body}
            </>
          ) : (
            <GestureDetector gesture={pan}>
              <View style={{ flexShrink: 1 }}>
                {header}
                {body}
              </View>
            </GestureDetector>
          )}
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  );
}

function MenuGroup({ section, onPick, selectable }: { section: MenuSection; onPick: (i: MenuItem) => void; selectable: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      {section.title ? (
        <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row} style={{ paddingHorizontal: space.lg }}>
          {section.title}
        </Text>
      ) : null}
      <Group>
        {section.items.map((item, i) => (
          <MenuRow key={`${i}-${item.label}`} item={item} onPress={() => onPick(item)} selectable={selectable} />
        ))}
      </Group>
    </View>
  );
}

/**
 * One menu row: icon (or free leading content), label, optional detail, and a value or a check at
 * the right. At least `sheet.rowHeight` high; it grows with the text. Exported so that an inline
 * menu (the composer "+" menu, the command menu) uses the same row look. `selectable`: the row
 * reports its selected state to VoiceOver (a picker).
 */
export function MenuRow({ item, onPress, selectable }: { item: Omit<MenuItem, "onPick">; onPress: () => void; selectable?: boolean }) {
  const red = !!item.destructive || !!item.danger;
  const tint = red ? colors.danger : colors.text;
  const label = [item.label, item.value, item.detail].filter(Boolean).join(", ");
  let lead: ReactNode = item.leading ?? null;
  if (!lead && item.Icon) lead = <item.Icon size={icon.md} color={red ? colors.danger : colors.textMuted} strokeWidth={icon.strokeWidth} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={item.accessibilityHint}
      accessibilityState={selectable ? { selected: !!item.checked, disabled: !!item.disabled } : { disabled: !!item.disabled }}
      disabled={item.disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: sheet.rowHeight,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: item.disabled ? state.disabledOpacity : 1,
      })}
    >
      {lead}
      <View style={{ flex: 1, gap: 2 }}>
        <Text color={tint}>{item.label}</Text>
        {item.detail ? (
          <Text variant="small" muted>
            {item.detail}
          </Text>
        ) : null}
      </View>
      {item.value ? (
        <Text variant="small" muted numberOfLines={1} style={{ flexShrink: 1, maxWidth: "45%", textAlign: "right" }}>
          {item.value}
        </Text>
      ) : null}
      {item.checked ? <Check size={icon.md} color={colors.accent} strokeWidth={icon.strokeWidth} /> : null}
    </Pressable>
  );
}
