import type { Automation, AutomationRun } from "@herdling/protocol";
import { useRouter } from "expo-router";
import { CircleAlert, CircleSlash, Clock, Info, Server, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAutomations } from "@/automations/useAutomations";
import { timeAgo } from "@/hosts/ConnBadge";
import { retryNow, useHostConn } from "@/hosts/connection";
import { useHosts, type Host } from "@/hosts/store";
import { colors, hitTarget, space, state as uiState } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Group, Pad, Section } from "@/ui/Group";
import { Screen } from "@/ui/Screen";
import { CloseButton } from "@/ui/CloseButton";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

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

function ApproveSheet({
  automation,
  onClose,
  onApprove,
}: {
  automation: Automation | undefined;
  onClose: () => void;
  onApprove: (a: Automation) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
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
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: space.lg + insets.bottom }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
              Approve {a?.name}
            </Text>
            <CloseButton onPress={onClose} />
          </View>
          <Text variant="caption" muted>
            Plan
          </Text>
          <Text mono variant="small">
            {a?.plan ?? "No plan provided."}
          </Text>
          <Text variant="caption" muted>
            Capabilities
          </Text>
          <Text variant="small">{a?.caps?.length ? a.caps.join(", ") : "None listed."}</Text>
          <Text variant="caption" muted>
            Content hash
          </Text>
          <Text mono variant="small" selectable>
            {a?.content_hash ?? "Missing"}
          </Text>
          {error ? (
            <Text variant="small" color={colors.danger}>
              {error}
            </Text>
          ) : null}
          <Button label="Approve" Icon={ShieldCheck} onPress={() => void submit()} loading={busy} disabled={!a?.content_hash} />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
        </ScrollView>
      </View>
    </Modal>
  );
}

function AutomationRow({ a, onReview }: { a: Automation; onReview: (a: Automation) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text bold numberOfLines={1}>
        {a.name}
      </Text>
      <Text variant="caption" muted>
        {a.enabled ? "Enabled" : "Disabled"}
        {a.schedule ? ` · ${a.schedule}` : ""}
      </Text>
      {a.pending_approval ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review ${a.name}`}
          onPress={() => onReview(a)}
          style={{ minHeight: hitTarget, flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <CircleAlert size={16} color={colors.status.blocked} />
          <Text variant="small" bold color={colors.status.blocked}>
            Needs approval
          </Text>
          <Text variant="small" muted>
            Review
          </Text>
        </Pressable>
      ) : null}
    </View>
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
  return (
    <Section title={host.name}>
      <View style={online ? undefined : { opacity: uiState.offlineOpacity }}>
      <Group>
      <Pad>
      {!online ? (
        <StateNotice
          Icon={CircleSlash}
          message={conn.status === "connecting" ? "Connecting…" : conn.lastSeen ? `Offline · seen ${timeAgo(conn.lastSeen)}` : "Offline"}
          action={conn.status === "connecting" ? undefined : "Retry"}
          onAction={() => retryNow(host.id)}
        />
      ) : state.kind === "loading" ? (
        <Text variant="small" muted>
          Loading…
        </Text>
      ) : state.kind === "outdated" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Info size={16} color={colors.textMuted} />
          <Text variant="small" muted style={{ flex: 1 }}>
            This host runs an older herdlingd. Update it to use automations.
          </Text>
        </View>
      ) : state.kind === "not_installed" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Info size={16} color={colors.textMuted} />
          <Text variant="small" muted style={{ flex: 1 }}>
            herdr-automate is not installed on {host.name}
          </Text>
        </View>
      ) : state.kind === "error" ? (
        <StateNotice Icon={CircleAlert} color={colors.danger} message={state.message} action="Retry" onAction={() => void refresh()} />
      ) : (
        <>
          {state.automations.length === 0 ? (
            <Text variant="small" muted>
              No automations.
            </Text>
          ) : (
            state.automations.map((a) => <AutomationRow key={a.id} a={a} onReview={setReviewing} />)
          )}
          {state.runs.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Text variant="caption" muted>
                Last runs
              </Text>
              {state.runs.slice(0, 5).map((r) => (
                <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Clock size={14} color={runColor(r.status)} />
                  <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>
                    {names?.get(r.automation_id) ?? r.automation_id}
                  </Text>
                  <Text variant="caption" color={runColor(r.status)}>
                    {RUN_LABEL[r.status]}
                  </Text>
                  <Text variant="caption" muted>
                    {when(r.started_at)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
      </Pad>
      </Group>
      </View>
      <ApproveSheet automation={reviewing} onClose={() => setReviewing(undefined)} onApprove={approve} />
    </Section>
  );
}

export default function AutomationsScreen() {
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
        <Pad>
          <StateNotice Icon={Server} message="No hosts yet." action="Add a host" onAction={() => router.push("/hosts/discover" as never)} />
        </Pad>
      ) : (
        hosts.map((h) => <HostAutomations key={h.id} host={h} register={register} />)
      )}
    </Screen>
  );
}
