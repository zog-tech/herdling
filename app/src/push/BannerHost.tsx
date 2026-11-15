/**
 * The in-app banner on screen, and the store that runs `bannerReducer` and its effects. The store
 * lives outside React, so the foreground push handler of the root layout can feed it too.
 * A tap opens the session (compact: the session route; regular: the detail column of Overview).
 * The close button or a swipe up hides it. VoiceOver and TalkBack announce each banner.
 */
import { useRouter, type Href } from "expo-router";
import { Check, Hand, SquareTerminal } from "lucide-react-native";
import { useEffect } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { create } from "zustand";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHosts } from "@/hosts/store";
import { colors, hitTarget, icon, motion, radius, space } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { GlassSurface } from "@/ui/Glass";
import * as haptics from "@/ui/haptics";
import { useLayoutClass } from "@/ui/layout";
import { Text } from "@/ui/Text";

import { BANNER_START, bannerItems, bannerReducer, type BannerEvent, type BannerItem, type BannerState } from "./banner";
import { useNotifPrefs } from "./prefs";
import { showBannerFor } from "./useNotificationRouting";

export const useBanner = create<BannerState>(() => BANNER_START);

const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Runs one event: the new state, then its effects (timers, a haptic). */
export function dispatchBanner(e: BannerEvent): void {
  const { state, effects } = bannerReducer(useBanner.getState(), e);
  if (state !== useBanner.getState()) useBanner.setState(state, true);
  for (const f of effects) {
    if (f.type === "haptic") haptics.tap();
    else timers.set(f.gen, setTimeout(() => {
      timers.delete(f.gen);
      dispatchBanner({ type: "timeout", gen: f.gen });
    }, f.ms));
  }
  if (state.current) AccessibilityInfo.announceForAccessibility(`${state.current.title}. ${state.current.detail}`);
}

/**
 * True when the banner may show this item: never for the session on screen (`showBannerFor`), and
 * only for the kinds that the notification settings allow.
 */
export function bannerAllowed(i: BannerItem): boolean {
  if (!showBannerFor({ hostId: i.hostId, paneId: i.paneId })) return false;
  const prefs = useNotifPrefs.getState();
  return i.kind === "blocked" ? prefs.needs_you : i.kind === "done" ? prefs.finished : true;
}

/** Adds banners now. */
export function addBanners(items: BannerItem[]): void {
  if (items.length > 0) dispatchBanner({ type: "arrive", items, now: Date.now(), allowed: bannerAllowed });
}

/** The user opened this pane: its banners go away. */
export function bannerOpened(hostId: string, paneId: string): void {
  dispatchBanner({ type: "opened", hostId, paneId });
}

let mounted = 0;

/** True while a `BannerHost` is on screen. Then a foreground push shows here, not as a system banner. */
export function bannerShowing(): boolean {
  return mounted > 0;
}

const EASE_OUT = Easing.bezier(...motion.ease.out);

const ICON = {
  blocked: { Icon: Hand, color: () => colors.status.blocked },
  done: { Icon: Check, color: () => colors.status.done },
  shell: { Icon: SquareTerminal, color: () => colors.status.done },
} as const;

/** The banner itself. Mount it once, near the root, inside the themed part. */
export function BannerHost() {
  const current = useBanner((s) => s.current);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const router = useRouter();
  const layout = useLayoutClass();
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    mounted += 1;
    // Status changes in the live snapshots: an agent that needs you or finished.
    const unsub = useSnapshots.subscribe((s, prev) => {
      const hosts = useHosts.getState().hosts;
      const items = Object.keys(s.byHost).flatMap((id) =>
        s.byHost[id] === prev.byHost[id]
          ? []
          : bannerItems(id, hosts.find((h) => h.id === id)?.name ?? id, prev.byHost[id], s.byHost[id]),
      );
      addBanners(items);
    });
    return () => {
      mounted -= 1;
      unsub();
    };
  }, []);

  useEffect(() => {
    drag.set(0);
    progress.set(current ? withTiming(1, { duration: motion.enterMs, easing: EASE_OUT }) : 0);
  }, [current, progress, drag]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (reduced ? 0 : (progress.get() - 1) * space.md) + Math.min(0, drag.get()) }],
  }));

  const dismiss = (gen: number) => dispatchBanner({ type: "dismiss", gen });
  const gesture = usePanGesture({
    activeOffsetY: [-10, 10],
    onUpdate: (e) => drag.set(e.translationY),
    onDeactivate: (e) => {
      if (!e.canceled && (e.translationY < -24 || e.velocityY < -400) && current) scheduleOnRN(dismiss, current.gen);
      else drag.set(withTiming(0, { duration: motion.stateMs }));
    },
  });

  if (!current) return null;
  const { Icon, color } = ICON[current.kind];
  const open = () => {
    haptics.tap();
    dismiss(current.gen);
    const shell = current.kind === "shell";
    if (layout === "regular") router.navigate({ pathname: "/", params: { host: current.hostId, pane: current.paneId } });
    else router.navigate(`/session/${encodeURIComponent(current.hostId)}/${encodeURIComponent(current.paneId)}${shell ? "?shell=1" : ""}` as Href);
  };
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + space.xs, left: space.md, right: space.md, alignItems: "center" }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width: "100%", maxWidth: 520 }, style]}>
          <GlassSurface style={{ borderRadius: radius.lg, overflow: "hidden", flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.edge }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${current.title}. ${current.detail}`}
              accessibilityHint="Opens this session"
              accessibilityLiveRegion="polite"
              onPress={open}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: hitTarget,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingVertical: space.sm,
                paddingLeft: space.md,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Icon size={icon.md} color={color()} />
              <View style={{ flex: 1 }}>
                <Text bold numberOfLines={1}>
                  {current.title}
                </Text>
                {current.detail ? (
                  <Text variant="caption" muted numberOfLines={1}>
                    {current.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <CloseButton label="Hide" onPress={() => dismiss(current.gen)} />
          </GlassSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
