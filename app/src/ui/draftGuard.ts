import { useNavigation, usePreventRemove } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

/** Asks before a draft is thrown away. True when the user picks "Discard". */
export function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert("Discard draft?", "The text you typed is not sent and goes away.", [
      { text: "Keep editing", style: "cancel", onPress: () => resolve(false) },
      { text: "Discard", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

type NavAction = Parameters<NonNullable<Parameters<typeof usePreventRemove>[1]>>[0]["data"]["action"];

/**
 * For a sheet or modal screen with a draft: while `hasDraft`, swipe-down is off and every way out
 * (close button, back, "Open") asks first. `lock` turns swipe-down off without the question (for
 * example while a start is in flight). Call the returned `allowLeave` just before the screen leaves
 * because the draft was used (sent or started).
 *
 * A prevented action is sent again only after the prevention is off: while it is on, the router
 * prevents the same action again, and an immediate resend loops until React stops it.
 */
export function useDraftGuard(hasDraft: boolean, o?: { lock?: boolean }): () => void {
  const navigation = useNavigation();
  const allowed = useRef(false);
  const [released, setReleased] = useState(false);
  const pending = useRef<NavAction | null>(null);
  const lock = !!o?.lock;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !hasDraft && !lock });
  }, [navigation, hasDraft, lock]);
  const release = useCallback((action: NavAction) => {
    pending.current = action;
    setReleased(true);
  }, []);
  usePreventRemove(hasDraft && !released, ({ data }) => {
    if (allowed.current) {
      release(data.action);
      return;
    }
    void confirmDiscard().then((ok) => ok && release(data.action));
  });
  // Runs after the commit that turned the prevention off.
  useEffect(() => {
    const action = pending.current;
    if (!released || !action) return;
    pending.current = null;
    navigation.dispatch(action);
  }, [released, navigation]);
  return useCallback(() => {
    allowed.current = true;
  }, []);
}
