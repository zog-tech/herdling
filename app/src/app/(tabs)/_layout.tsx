import { NativeTabs } from "expo-router/native-tabs";
import { Platform } from "react-native";

import { needsYouCount } from "@/board/tasks";
import { useSnapshots } from "@/herdr/snapshotStore";
import { useOnlineHostKey } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { withAlpha } from "@/theme/contrast";
import { colors } from "@/theme/tokens";

/**
 * Android: a Material bottom bar on `card`, a faint accent pill behind the selected icon, and the
 * labels always visible. iOS ignores these props, but they stay out of the iOS bar on purpose.
 * A function: the colors change with the theme.
 */
const androidBar = () =>
  Platform.OS === "android"
    ? ({
        backgroundColor: colors.card,
        indicatorColor: withAlpha(colors.accent, 0.16),
        rippleColor: withAlpha(colors.accent, 0.12),
        labelVisibilityMode: "labeled",
      } as const)
    : {};

/** The count of agents that need the user on the online computers: the badge of the Agents tab. */
function useNeedsYou(): number {
  const ids = useHosts((s) => s.hosts.map((h) => h.id).join(","));
  const online = useOnlineHostKey(ids ? ids.split(",") : []);
  return useSnapshots((s) => needsYouCount((online ? online.split(",") : []).map((id) => s.byHost[id])));
}

/**
 * The system tab bar (UITabBarController): Liquid Glass on iOS 26, a blurred bar before.
 * Three tabs (design rule 5): Agents (route `(overview)`), Spaces and More (route `settings`).
 * The route names stay, so deep links and push routing do not change. Usage and Automations are
 * stack screens (`/usage`, `/automations`) that open from More.
 * SF Symbols, gold for the selected tab. Each tab has its own native stack for its header.
 * Android has no SF Symbols: `src` gives it Material Symbols images (white, tinted by the bar).
 * `sidebarAdaptable` (iOS 18+): on iPad the tab bar can turn into a sidebar. iPhone keeps the
 * tab bar (iOS 27 shows the sidebar only on large iPhones in landscape, and Herdling is portrait).
 */
export default function TabsLayout() {
  const needsYou = useNeedsYou();
  return (
    <NativeTabs
      sidebarAdaptable
      tintColor={colors.accent}
      iconColor={{ default: colors.textMuted, selected: colors.accent }}
      labelStyle={{ default: { color: colors.textMuted }, selected: { color: colors.accent } }}
      blurEffect="systemChromeMaterialDark"
      {...androidBar()}
    >
      <NativeTabs.Trigger name="(overview)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          src={{ default: require("../../../assets/images/tabs/overview.png"), selected: require("../../../assets/images/tabs/overview-fill.png") }}
        />
        <NativeTabs.Trigger.Label>Agents</NativeTabs.Trigger.Label>
        {/* The count of agents that need you, as on the app icon of a mail app. No badge at 0:
            expo-router ignores `hidden` when the badge has text, so the element must be absent. */}
        {needsYou > 0 ? <NativeTabs.Trigger.Badge>{String(needsYou)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      {/* Spaces: the Herdr app spaces of each computer. Second, next to the board: the second way to find an agent. */}
      <NativeTabs.Trigger name="spaces">
        <NativeTabs.Trigger.Icon
          sf={{ default: "rectangle.3.group", selected: "rectangle.3.group.fill" }}
          src={{ default: require("../../../assets/images/tabs/spaces.png"), selected: require("../../../assets/images/tabs/spaces-fill.png") }}
        />
        <NativeTabs.Trigger.Label>Spaces</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* More: the route stays `settings`, so old links land here. Usage and Automations open from its rows.
          Android has no "more" image yet: it keeps the gear, which also says "settings". */}
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: "ellipsis.circle", selected: "ellipsis.circle.fill" }}
          src={{ default: require("../../../assets/images/tabs/settings.png"), selected: require("../../../assets/images/tabs/settings-fill.png") }}
        />
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
