import { useEffect, useState } from "react";
import { ActivityIndicator, View, type ActivityIndicatorProps } from "react-native";

/** Waits under this long show no spinner: a flash of one reads as a glitch. */
export const SPINNER_DELAY_MS = 300;

/** True once `on` has stayed true for `ms`; false again at once when `on` turns false. */
export function useDelayed(on: boolean, ms = SPINNER_DELAY_MS): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && late;
}

/**
 * A spinner that shows only after 300 ms. Before that, `fallback` (for example the button's own
 * icon) or an empty box of the spinner's size, so nothing moves when it appears.
 */
export function DelayedSpinner({ fallback, ...props }: ActivityIndicatorProps & { fallback?: React.ReactNode }) {
  const show = useDelayed(true);
  if (show) return <ActivityIndicator {...props} />;
  return fallback !== undefined ? <>{fallback}</> : <View style={{ width: 20, height: 20 }} />;
}
