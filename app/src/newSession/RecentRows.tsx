import type { RecentSession } from "@herdling/protocol";
import { Pressable, View } from "react-native";

import { timeAgo } from "@/hosts/ConnBadge";
import { colors, hitTarget, space, state } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { Group } from "@/ui/Group";
import { Text } from "@/ui/Text";

import { baseName, displayPath } from "./paths";

/**
 * The latest sessions of the chosen agent, as rows of one `Group`: the first prompt (2 lines), and
 * the folder and the age as the detail. A tap resumes the session.
 */
export function RecentSessionRows({
  sessions,
  home,
  resuming,
  onResume,
  disabled,
}: {
  sessions: RecentSession[];
  home: string | undefined;
  resuming: string | undefined;
  onResume: (s: RecentSession) => void;
  disabled?: boolean;
}) {
  if (sessions.length === 0) return null;
  return (
    <Group>
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
              minHeight: hitTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              backgroundColor: pressed ? colors.raised : "transparent",
              opacity: off && !busy ? state.disabledOpacity : 1,
            })}
          >
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text numberOfLines={2}>{title}</Text>
              <Text variant="small" muted numberOfLines={1}>
                <Text variant="small" muted mono>
                  {baseName(s.cwd)}
                </Text>
                {` · ${timeAgo(s.last_activity)}`}
              </Text>
            </View>
            {busy ? <DelayedSpinner color={colors.textMuted} /> : null}
          </Pressable>
        );
      })}
    </Group>
  );
}
