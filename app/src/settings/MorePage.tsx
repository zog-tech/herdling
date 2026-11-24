import { useRouter, type Href } from "expo-router";
import {
  AudioLines,
  Bell,
  Gauge,
  Info,
  Laptop,
  MessageSquareQuote,
  Palette,
  SlidersHorizontal,
  SquareTerminal,
  Stethoscope,
  Workflow,
  type LucideIcon,
} from "lucide-react-native";

import { useNotifPrefs } from "@/push/prefs";
import { useHosts } from "@/hosts/store";
import { useTerminalRenderer } from "@/terminal/renderer";
import { useSavedPrompts } from "@/thread/savedPrompts";
import { themeDef } from "@/theme/palettes";
import { useThemePrefs } from "@/theme/themePrefs";
import { Group, Section } from "@/ui/Group";
import { PickerRow } from "@/ui/PickerRow";
import { Screen } from "@/ui/Screen";

import { appVersion } from "./AboutPage";
import { countValue, notifValue } from "./moreValues";
import { usageValue, useUsageSummary } from "./usageSummary";

/** The routes of the More pages. Usage and Automations are stack screens outside the tab bar. */
export const MORE_ROUTES = {
  computers: "/settings/computers",
  usage: "/usage",
  automations: "/automations",
  appearance: "/settings/appearance",
  voice: "/settings/voice",
  notifications: "/settings/notifications",
  terminal: "/settings/terminal",
  prompts: "/saved-prompts",
  general: "/settings/general",
  diagnostics: "/settings/diagnostics",
  about: "/settings/about",
} as const;

type Page = keyof typeof MORE_ROUTES;

/** One row of the index: its icon, its title and, where one value sums the page up, that value. */
function PageRow({ page, title, Icon, value, hint }: { page: Page; title: string; Icon: LucideIcon; value?: string; hint?: string }) {
  const router = useRouter();
  return (
    <PickerRow
      title={title}
      Icon={Icon}
      value={value}
      accessibilityHint={hint}
      onPress={() => router.push(MORE_ROUTES[page] as Href) /* typed routes regenerate on the next dev start */}
    />
  );
}

/**
 * The More tab (design rule 5): a short index of rows. Each row opens one page. The first group is
 * the computers and what runs on them, the second the settings, the last the logs and the version.
 */
export function MorePage() {
  const hosts = useHosts((s) => s.hosts);
  const hostIds = hosts.map((h) => h.id);
  const usage = useUsageSummary((s) => usageValue(s.byHost, hostIds));
  const theme = useThemePrefs((s) => s.theme);
  const renderer = useTerminalRenderer((s) => s.renderer);
  const prompts = useSavedPrompts((s) => s.prompts.length);
  const finished = useNotifPrefs((s) => s.finished);
  const needsYou = useNotifPrefs((s) => s.needs_you);
  return (
    <Screen flush>
      <Section>
        <Group>
          <PageRow page="computers" title="Computers" Icon={Laptop} value={countValue(hosts.length)} hint="Shows the computers, Add a computer and the demo" />
          <PageRow page="usage" title="Usage" Icon={Gauge} value={usage} hint="Shows the plan use and the load of each computer" />
          <PageRow page="automations" title="Automations" Icon={Workflow} />
        </Group>
      </Section>
      <Section>
        <Group>
          <PageRow page="appearance" title="Appearance" Icon={Palette} value={themeDef(theme).label} />
          <PageRow page="voice" title="Voice" Icon={AudioLines} />
          <PageRow page="notifications" title="Notifications" Icon={Bell} value={notifValue({ finished, needs_you: needsYou })} />
          <PageRow page="terminal" title="Terminal" Icon={SquareTerminal} value={renderer === "terminal" ? "Terminal" : "Classic"} />
          <PageRow page="prompts" title="Prompts" Icon={MessageSquareQuote} value={countValue(prompts)} hint="Shows the saved prompts" />
          <PageRow page="general" title="General" Icon={SlidersHorizontal} />
        </Group>
      </Section>
      <Section>
        <Group>
          <PageRow page="diagnostics" title="Diagnostics" Icon={Stethoscope} />
          <PageRow page="about" title="About" Icon={Info} value={appVersion()} />
        </Group>
      </Section>
    </Screen>
  );
}
