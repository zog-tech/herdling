import { CircleAlert, CircleCheck } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { Row } from "@/ui/Row";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

/**
 * The small parts that the screens of the computer flow (add, discover, pair, password setup,
 * update, the help pages, the host screen) share, so that the flow has one look. Each screen is a
 * `Screen flush` with `Section` + `Group` bands and its main action in an `ActionBar`.
 */

/** The muted lead text at the top of a flow screen, at the band inset. */
export function Lead({ children }: { children: ReactNode }) {
  return (
    <Text variant="small" muted style={{ paddingHorizontal: space.lg }}>
      {children}
    </Text>
  );
}

/**
 * A step that runs: a spinner after 300 ms and one line of text. VoiceOver reads the change.
 * `bare`: no side inset, for use inside a `Pad` of a `Group`.
 */
export function Working({ text, bare }: { text: string; bare?: boolean }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: bare ? 0 : space.lg }}>
      <DelayedSpinner color={colors.textMuted} />
      <Text muted style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** The result of a step: a check in the done color, or an alert in the danger color. `bare`: as for `Working`. */
export function Outcome({ ok, text, bare }: { ok: boolean; text: string; bare?: boolean }) {
  return (
    <View style={{ paddingHorizontal: bare ? 0 : space.lg }}>
      <StateNotice inline Icon={ok ? CircleCheck : CircleAlert} color={ok ? colors.status.done : colors.danger} message={text} />
    </View>
  );
}

/** A key fingerprint as a row: the title, then the fingerprint in mono that the user can select. */
export function KeyRow({ title, fingerprint, empty }: { title: string; fingerprint?: string; empty?: string }) {
  return (
    <Row title={title}>
      {fingerprint ? (
        <Text variant="caption" mono selectable accessibilityLabel={`${title} ${fingerprint}`}>
          {fingerprint}
        </Text>
      ) : (
        <Text variant="caption" muted>
          {empty ?? "Not known yet."}
        </Text>
      )}
    </Row>
  );
}
