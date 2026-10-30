import { Bot, Code, Cpu, Gem, Hand, Inbox, Loader, Moon, MousePointer2, Plane, Sparkles, SquareTerminal, Zap } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors } from "@/theme/tokens";

import type { Bucket } from "./buckets";

/** Color + icon per bucket. Status is never shown by color alone. */
export const BUCKET_META: Record<Bucket, { color: string; Icon: LucideIcon }> = {
  needs_you: { color: colors.status.blocked, Icon: Hand },
  ready: { color: colors.status.idle, Icon: Inbox },
  working: { color: colors.status.working, Icon: Loader },
  idle: { color: colors.status.unknown, Icon: Moon },
};

const KIND_ICON: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: SquareTerminal,
  gemini: Gem,
  opencode: Code,
  amp: Zap,
  cursor: MousePointer2,
  copilot: Plane,
  droid: Cpu,
};

/** Icon of an agent kind; kinds without their own icon get a generic bot. */
export function kindIcon(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? Bot;
}
