import { useContext, type ComponentProps, type ReactNode } from "react";
import { Pressable, type AccessibilityActionEvent } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

import { motion, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";

import { ThreadPaneContext } from "./LiveToolContext";
import { copyText, openRowMenu, readableText, type MenuTarget } from "./rowMenu";

const EASE_OUT = Easing.bezier(...motion.ease.out);
const { press } = motion;

type Props = Omit<
  ComponentProps<typeof Pressable>,
  "children" | "onLongPress" | "delayLongPress" | "accessibilityActions" | "onAccessibilityAction"
> & {
  children?: ReactNode;
  /** What the menu acts on. Null: no menu (for example a redacted thought). */
  menu: MenuTarget | null;
  /** "dim": the content dims while the finger is down. "none": the caller draws its own pressed state. */
  feedback?: "dim" | "none";
};

/**
 * A Pressable whose long press opens the row menu (Copy, Select text, Share, ...). A tap still runs
 * `onPress`, and a fired long press never runs it. A move (a scroll) cancels the long press.
 * VoiceOver and TalkBack get the actions "Copy" and "More options".
 * Press feedback: after `motion.press.inMs` the content dims to `state.pressedFill`, so a quick
 * scroll shows none. The size does not change: a message that shrinks under the finger looks wrong.
 */
export function MenuPressable({ menu, feedback = "none", onPress, onPressIn, onPressOut, children, ...rest }: Props) {
  const pane = useContext(ThreadPaneContext);
  const dip = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({ opacity: 1 - dip.get() * (1 - state.pressedFill) }));
  const dims = feedback === "dim" && !!menu;
  const release = () => dip.set(withTiming(0, { duration: press.inMs, easing: EASE_OUT }));
  const open = () => {
    if (!menu) return;
    release();
    haptics.press();
    openRowMenu(menu, pane);
  };
  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === "activate") onPress?.(e as never);
    else if (name === "copy" && menu) void copyText(readableText(menu));
    else if (name === "menu") open();
  };
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      onLongPress={menu ? open : undefined}
      delayLongPress={press.longPressMs}
      onPressIn={(e) => {
        if (dims) dip.set(withDelay(press.inMs, withTiming(1, { duration: press.inMs, easing: EASE_OUT })));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (dims) release();
        onPressOut?.(e);
      }}
      accessibilityActions={
        menu
          ? [...(onPress ? [{ name: "activate" as const }] : []), { name: "copy", label: "Copy" }, { name: "menu", label: "More options" }]
          : undefined
      }
      onAccessibilityAction={menu ? onAction : undefined}
    >
      {dims ? <Animated.View style={anim}>{children}</Animated.View> : children}
    </Pressable>
  );
}
