import {
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";

export const fontFamily = {
  mono: "JetBrainsMono_400Regular",
  monoBold: "JetBrainsMono_700Bold",
} as const;

/** Loads JetBrains Mono. Returns true when ready (or when loading failed, so the app still renders). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [fontFamily.mono]: JetBrainsMono_400Regular,
    [fontFamily.monoBold]: JetBrainsMono_700Bold,
  });
  return loaded || error != null;
}
