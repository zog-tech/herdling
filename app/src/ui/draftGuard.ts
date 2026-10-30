import { useNavigation, usePreventRemove } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
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

/**
 * For a sheet or modal screen with a draft: while `hasDraft`, swipe-down is off and every way out
 * (close button, back, "Open") asks first. `lock` turns swipe-down off without the question (for
 * example while a start is in flight). Call the returned `allowLeave` just before the screen leaves
 * because the draft was used (sent or started).
 */
export function useDraftGuard(hasDraft: boolean, o?: { lock?: boolean }): () => void {
  const navigation = useNavigation();
  const allowed = useRef(false);
  const lock = !!o?.lock;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !hasDraft && !lock });
  }, [navigation, hasDraft, lock]);
  usePreventRemove(hasDraft, ({ data }) => {
    if (allowed.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirmDiscard().then((ok) => ok && navigation.dispatch(data.action));
  });
  return useCallback(() => {
    allowed.current = true;
  }, []);
}
