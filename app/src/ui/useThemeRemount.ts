import { useNavigationContainerRef } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { useThemePrefs } from "@/theme/themePrefs";

type NavRef = ReturnType<typeof useNavigationContainerRef>;
type RootState = ReturnType<NavRef["getRootState"]>;

/** The key of the focused screen. The typed route list makes `getCurrentRoute` hard to type. */
const focusedKey = (ref: NavRef): string | undefined => (ref.getCurrentRoute() as { key?: string } | undefined)?.key;

/**
 * A key for the themed part of the root layout. Styles read `colors` at render time, but the
 * React Compiler keeps old elements while their inputs stay the same. So after a theme change the
 * screens mount again with this new key.
 *
 * The navigation state lives in the container, above the key, so the user stays on the same
 * screen. If the focused screen still changes, the saved state is put back.
 */
export function useThemeRemount(): number {
  const navRef = useNavigationContainerRef();
  const [key, setKey] = useState(0);
  const saved = useRef<{ state: RootState; focused: string | undefined } | undefined>(undefined);

  useEffect(
    () =>
      useThemePrefs.subscribe((s, prev) => {
        if (s.applied === prev.applied) return;
        const state = navRef.current ? navRef.getRootState() : undefined;
        saved.current = state ? { state, focused: focusedKey(navRef) } : undefined;
        setKey((k) => k + 1);
      }),
    [navRef],
  );

  useEffect(() => {
    const s = saved.current;
    saved.current = undefined;
    if (s && navRef.current && focusedKey(navRef) !== s.focused) navRef.reset(s.state);
  }, [key, navRef]);

  return key;
}
