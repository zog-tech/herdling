/**
 * The hardware keyboard shortcuts that work on every screen: ⌘1 to ⌘4 for the tabs and ⌘N for a
 * new session. Rendered once in the root layout. Screens add their own shortcuts with `useKeyCommand`.
 */
import { useRouter, type Href } from "expo-router";

import { useKeyCommand } from "./keyCommands";
import { TAB_ROUTES } from "./shortcuts";

export function AppShortcuts() {
  const router = useRouter();
  useKeyCommand("tab1", () => router.navigate(TAB_ROUTES.tab1 as Href));
  useKeyCommand("tab2", () => router.navigate(TAB_ROUTES.tab2 as Href));
  useKeyCommand("tab3", () => router.navigate(TAB_ROUTES.tab3 as Href));
  useKeyCommand("tab4", () => router.navigate(TAB_ROUTES.tab4 as Href));
  useKeyCommand("newSession", () => router.push("/new" as Href));
  return null;
}
