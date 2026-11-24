import type { Automation, AutomationRun } from "@herdling/protocol";
import { useRouter } from "expo-router";
import { CircleAlert, CircleSlash, Clock, Info, Server, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, RefreshControl, ScrollView, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { timeAgo } from "@/hosts/ConnBadge";
import { retryNow, useHostConn } from "@/hosts/connection";
import { Outcome, Working } from "@/hosts/flowParts";
import { useHosts, type Host } from "@/hosts/store";
import { colors, icon, space, state as uiState } from "@/theme/tokens";
import { ActionBar, useActionBarSpace } from "@/ui/ActionBar";
import { CloseButton } from "@/ui/CloseButton";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

import { useAutomations } from "./useAutomations";

/**
 * The Automations screen (a stack screen that opens from More): per computer, the automations of
 * `herdr-automate` as rows, the last runs as rows, and the approve sheet for an automation that
 * waits for approval. Pull to refresh reads every computer at once. The route file renders
 * `AutomationsScreen`.
 */

const RUN_LABEL: Record<AutomationRun["status"], string> = {
  running: "Running",
  ok: "OK",
  failed: "Failed",
  pending_approval: "Needs approval",
};
/** A function: the colors change with the theme. */
const runColor = (s: AutomationRun["status"]): string =>
  ({ running: colors.status.working, ok: colors.status.done, failed: colors.danger, pending_approval: colors.status.blocked })[s];

function when(s: number): string {
  return new Date(s * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A titled band of the sheet: the small uppercase title and the text in a `Pad`. */
function SheetPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <Group>
        <Pad>{children}</Pad>
      </Group>
    </Section>
  );
}

function ApproveSheet({
  automation,
  onClose,
  onApprove,
}: {
  automation: Automation | undefined;
  onClose: () => void;
  onApprove: (a: Automation) => Promise<void>;
}) {
  const reduced = useReducedMotion();
  const bar = useActionBarSpace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setError(undefined);
    setBusy(false);
  }, [automation?.id]);
  const a = automation;
  const submit = async () => {
    if (!a) return;
    setBusy(true);
    setError(undefined);
    try {
      await onApprove(a);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    // A native page sheet: swipe-down closes it (onRequestClose), and so does the close button.
    <Modal visible={!!a} animationType={reduced ? "fade" : "slide"} presentationStyle="pageSheet" onRequestClose={busy ? () => {} : onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.md }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            Approve {a?.name}
          </Text>
          <CloseButton onPress={onClose} />
        </View>
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: space.lg, gap: space.xl, paddingBottom: bar.contentPadding }}>
          <SheetPart title="Plan">
            <Text mono variant="small">
              {a?.plan ?? "No plan provided."}
            </Text>
          </SheetPart>
          <SheetPart title="Capabilities">
            <Text variant="small">{a?.caps?.length ? a.caps.join(", ") : "None listed."}</Text>
          </SheetPart>
          <SheetPart title="Content hash">
            <Text mono variant="small" selectable>
              {a?.content_hash ?? "Missing"}
            </Text>
          </SheetPart>
          {error ? <Outcome ok={false} text={error} /> : null}
        </ScrollView>
        <ActionBar
          onSpace={bar.onSpace}
          primary={{ label: "Approve", Icon: ShieldCheck, loading: busy, disabled: !a?.content_hash, onPress: () => void submit() }}
          secondary={{ label: "Cancel", disabled: busy, onPress: onClose }}
        />
      </View>
    </Modal>
  );
}

/** One automation: its name, on or off and the schedule. One that waits for approval opens the approve sheet. */
function AutomationRow({ a, onReview }: { a: Automation; onReview: (a: Automation) => void }) {
  const detail = `${a.enabled ? "Enabled" : "Disabled"}${a.schedule ? ` · ${a.schedule}` : ""}`;
  if (!a.pending_approval) return <Row title={a.name} detail={detail} />;
  return (
    <Row
      title={a.name}
      detail={detail}
      trailing={<StatusDot label="Needs approval" color={colors.status.blocked} />}
      chevron
      accessibilityLabel={`Review ${a.name}`}
      accessibilityHint="Shows the plan and asks for your approval"
      onPress={() => onReview(a)}
    />
  );
}

/** One run: the automation name, when it started, and its status as dot + word. */
function RunRow({ r, name }: { r: AutomationRun; name: string }) {
  return (
    <Row
      title={name}
      detail={when(r.started_at)}
      leading={<Clock size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
      trailing={<StatusDot label={RUN_LABEL[r.status]} color={runColor(r.status)} lit={r.status === "running"} />}
    />
  );
}

function HostAutomations({
  host,
  register,
}: {
  host: Host;
  register: (id: string, fn: (() => Promise<void>) | undefined) => void;
}) {
  const conn = useHostConn(host.id);
  const online = conn.status === "online";
  const { state, refresh, approve } = useAutomations(host.id);
  const [reviewing, setReviewing] = useState<Automation>();
  useEffect(() => {
    register(host.id, refresh);
    return () => register(host.id, undefined);
  }, [host.id, refresh, register]);
  const names = state.kind === "ready" ? new Map(state.automations.map((a) => [a.id, a.name])) : undefined;

  let rows: ReactNode;
  if (!online) {
    rows = (
      <Pad>
        <StateNotice inline
          Icon={CircleSlash}
          message={conn.status === "connecting" ? "Connecting…" : conn.lastSeen ? `Offline · seen ${timeAgo(conn.lastSeen)}` : "Offline"}
          action={conn.status === "connecting" ? undefined : "Retry"}
          onAction={() => retryNow(host.id)}
        />
      </Pad>
    );
  } else if (state.kind === "loading") {
    rows = (
      <Pad>
        <Working bare text="Loading…" />
      </Pad>
    );
  } else if (state.kind === "outdated") {
    rows = (
      <Pad>
        <StateNotice inline Icon={Info} message="This computer runs an older herdlingd. Update it to use automations." />
      </Pad>
    );
  } else if (state.kind === "not_installed") {
    rows = (
      <Pad>
        <StateNotice inline Icon={Info} message={`herdr-automate is not installed on ${host.name}`} />
      </Pad>
    );
  } else if (state.kind === "error") {
    rows = (
      <Pad>
        <StateNotice inline Icon={CircleAlert} color={colors.danger} message={state.message} action="Retry" onAction={() => void refresh()} />
      </Pad>
    );
  } else if (state.automations.length === 0) {
    rows = (
      <Pad>
        <StateNotice inline Icon={Info} message="No automations." />
      </Pad>
    );
  } else {
    rows = state.automations.map((a) => <AutomationRow key={a.id} a={a} onReview={setReviewing} />);
  }

  const runs = online && state.kind === "ready" ? state.runs.slice(0, 5) : [];
  return (
    <>
      <Section title={host.name}>
        <View style={online ? undefined : { opacity: uiState.offlineOpacity }}>
          <Group>{rows}</Group>
        </View>
      </Section>
      {runs.length > 0 ? (
        <Section title={`Last runs · ${host.name}`}>
          <Group>
            {runs.map((r) => (
              <RunRow key={r.id} r={r} name={names?.get(r.automation_id) ?? r.automation_id} />
            ))}
          </Group>
        </Section>
      ) : null}
      <ApproveSheet automation={reviewing} onClose={() => setReviewing(undefined)} onApprove={approve} />
    </>
  );
}

export function AutomationsScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  const refreshers = useRef(new Map<string, () => Promise<void>>());
  const [refreshing, setRefreshing] = useState(false);
  const register = useCallback((id: string, fn: (() => Promise<void>) | undefined) => {
    if (fn) refreshers.current.set(id, fn);
    else refreshers.current.delete(id);
  }, []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([...refreshers.current.values()].map((f) => f()));
    } finally {
      setRefreshing(false);
    }
  }, []);
  return (
    <Screen flush refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}>
      {hosts.length === 0 ? (
        <StateNotice Icon={Server} message="No computers yet." action="Add a computer" onAction={() => router.push("/hosts/discover" as never)} />
      ) : (
        hosts.map((h) => <HostAutomations key={h.id} host={h} register={register} />)
      )}
    </Screen>
  );
}

export default AutomationsScreen;
