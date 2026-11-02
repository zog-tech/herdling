/**
 * The error screen of a route: an error in a render shows this screen instead of closing the app.
 * Routes export it as expo-router's `ErrorBoundary`. The error goes to the crash log.
 */
import type { ErrorBoundaryProps } from "expo-router";
import { useRouter } from "expo-router";
import { RotateCcw, TriangleAlert } from "lucide-react-native";
import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, icon, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import { recordCrash } from "./crashLog";
import { crashContext } from "./globalHandler";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || "Unknown error";

/**
 * "Something went wrong", the error message, Retry and Back. `layout`: the screen replaces a whole
 * layout (the root layout). Back then also renders the layout again, because no screen of the
 * layout is left to go back to. A screen with nothing to go back to goes to Overview and tries again.
 */
export function ErrorScreen({ error, retry, layout = false }: ErrorBoundaryProps & { layout?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    recordCrash(error, "screen", crashContext());
  }, [error]);
  const back = () => {
    const canGoBack = router.canGoBack();
    if (canGoBack) router.back();
    else router.replace("/");
    if (layout || !canGoBack) void retry();
  };
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        gap: space.lg,
        paddingHorizontal: space.xl,
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xl,
      }}
    >
      <TriangleAlert size={icon.lg} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      <Text variant="headline" accessibilityRole="header" style={{ textAlign: "center" }}>
        Something went wrong
      </Text>
      <Text muted selectable numberOfLines={6} style={{ textAlign: "center" }}>
        {message(error)}
      </Text>
      <Text variant="caption" muted style={{ textAlign: "center" }}>
        The app saved the error in Settings, Crash log.
      </Text>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Button label="Back" variant="secondary" onPress={back} />
        <Button label="Retry" Icon={RotateCcw} onPress={() => void retry()} />
      </View>
    </View>
  );
}

/** The `ErrorBoundary` of a screen route: `export { RouteErrorBoundary as ErrorBoundary } from "@/crash/ErrorScreen"`. */
export function RouteErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorScreen {...props} />;
}

/** The `ErrorBoundary` of a layout route (the root layout). */
export function LayoutErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorScreen {...props} layout />;
}
