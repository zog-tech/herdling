import type { RecentSession } from "@herdling/protocol";
import { Pressable, ScrollView, View } from "react-native";

import { timeAgo } from "@/hosts/ConnBadge";
import { colors, denseScale, elevation, hitTarget, radius, space, state } from "@/theme/tokens";
import { AgentMark } from "@/ui/AgentMark";
import { DelayedSpinner } from "@/ui/Delayed";
import { Text } from "@/ui/Text";

import { baseName, displayPath } from "./paths";
import type { RecentFolder } from "./recents";

/** Width of one recent session card: two fit next to each other on a phone. */
const CARD_WIDTH = 220;

/** A row that scrolls sideways and runs to the screen edges (the page has side padding). */
function SideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      style={{ marginHorizontal: -space.lg }}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}
    >
      {children}
    </ScrollView>
  );
}

/** Recent folders as one row of chips. A tap opens the folder in the browser. */
export function RecentFolderChips({
  folders,
  current,
  onOpen,
  disabled,
}: {
  folders: RecentFolder[];
  current: string | undefined;
  onOpen: (path: string) => void;
  disabled?: boolean;
}) {
  if (folders.length === 0) return null;
  return (
    <SideRow label="Recent folders">
      {folders.map((f) => {
        const here = f.path === current;
        return (
          <Pressable
            key={f.path}
            accessibilityRole="button"
            accessibilityLabel={`Recent folder ${f.display}`}
            accessibilityState={{ selected: here, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onOpen(f.path)}
            style={({ pressed }) => ({
              minHeight: hitTarget,
              justifyContent: "center",
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              // The open folder has the selected edge; gold stays for the selected state only.
              borderColor: here ? colors.accent : colors.divider,
              backgroundColor: pressed ? colors.raised : colors.card,
            })}
          >
            <Text mono variant="small" maxFontSizeMultiplier={denseScale.pill} numberOfLines={1}>
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </SideRow>
  );
}

/**
 * The latest sessions of the chosen agent, as cards in one row: the first prompt, the folder and
 * the age. A tap resumes the session in a new tab.
 */
export function RecentSessionCards({
  sessions,
  kind,
  home,
  resuming,
  onResume,
  disabled,
}: {
  sessions: RecentSession[];
  kind: string;
  home: string | undefined;
  resuming: string | undefined;
  onResume: (s: RecentSession) => void;
  disabled?: boolean;
}) {
  if (sessions.length === 0) return null;
  return (
    <SideRow label="Recent sessions">
      {sessions.map((s) => {
        const busy = resuming === s.session;
        const off = disabled || (resuming !== undefined && !busy);
        const folder = home ? displayPath(s.cwd, home) : s.cwd;
        const title = s.first_prompt || "Untitled session";
        return (
          <Pressable
            key={s.session}
            accessibilityRole="button"
            accessibilityLabel={`Resume: ${title}, in ${folder}, ${timeAgo(s.last_activity)}`}
            accessibilityState={{ disabled: !!off, busy }}
            disabled={off}
            onPress={() => onResume(s)}
            style={({ pressed }) => ({
              ...elevation.tappable,
              width: CARD_WIDTH,
              minHeight: hitTarget * 2,
              padding: space.md,
              gap: space.xs,
              borderRadius: radius.lg,
              backgroundColor: pressed ? colors.raised : colors.card,
              opacity: off && !busy ? state.disabledOpacity : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <AgentMark kind={kind} size={20} />
              <Text variant="caption" muted mono numberOfLines={1} style={{ flex: 1 }} maxFontSizeMultiplier={denseScale.pill}>
                {baseName(s.cwd)}
              </Text>
              {busy ? (
                <DelayedSpinner color={colors.textMuted} />
              ) : (
                <Text variant="caption" muted maxFontSizeMultiplier={denseScale.pill}>
                  {timeAgo(s.last_activity)}
                </Text>
              )}
            </View>
            <Text variant="small" numberOfLines={2}>
              {title}
            </Text>
          </Pressable>
        );
      })}
    </SideRow>
  );
}
