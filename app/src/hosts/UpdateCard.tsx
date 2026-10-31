import { useRouter } from "expo-router";
import { ArrowUpCircle, KeyRound } from "lucide-react-native";
import { useState } from "react";
import { Alert, View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { DelayedSpinner } from "@/ui/Delayed";
import { Text } from "@/ui/Text";

import { useHostConn } from "./connection";
import { useHosts } from "./store";
import { applyUpdate, updateStatus } from "./updates";

/** Longest part of the release notes in the confirmation. */
const NOTES_LIMIT = 600;

function confirmUpdate(from: string, to: string, notes: string): Promise<boolean> {
  const text = notes.trim() ? `\n\n${notes.trim().slice(0, NOTES_LIMIT)}` : "";
  return new Promise((resolve) => {
    Alert.alert(
      `Update herdlingd to ${to}?`,
      `The host runs ${from}. herdlingd downloads ${to} from GitHub, checks it and restarts. The connection drops for a moment.${text}`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Update", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** The herdlingd version of a host and its update, on the host screen. Nothing while the host is offline. */
export function UpdateCard({ hostId }: { hostId: string }) {
  const router = useRouter();
  const host = useHosts((s) => s.hosts.find((h) => h.id === hostId));
  const conn = useHostConn(hostId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  if (!host) return null;
  const hello = conn.status === "online" ? conn.hello : undefined;
  const status = updateStatus(host, hello);
  if (!hello && !busy && !result) return null;

  const update = async (from: string, to: string, notes: string) => {
    if (busy || !(await confirmUpdate(from, to, notes))) return;
    setBusy(true);
    setResult(undefined);
    try {
      const r = await applyUpdate(hostId);
      setResult({ ok: true, text: r.status === "up_to_date" ? `herdlingd ${r.version} is up to date.` : `herdlingd ${r.version} is running.` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "The update failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="title">herdlingd</Text>
      {hello ? (
        <Text variant="small" muted>
          Version {hello.herdlingd}
          {status.kind === "none" && host.updateCheck?.current === hello.herdlingd && !host.updateCheck.updateAvailable
            ? " · up to date"
            : ""}
        </Text>
      ) : null}
      {status.kind === "available" && !busy ? (
        <View style={{ gap: space.sm }}>
          <Text bold>
            Update available: {status.from} → {status.to}
          </Text>
          {status.notes.trim() ? (
            <Text variant="small" muted numberOfLines={6}>
              {status.notes.trim()}
            </Text>
          ) : null}
          <Button label="Update herdlingd" Icon={ArrowUpCircle} onPress={() => void update(status.from, status.to, status.notes)} />
        </View>
      ) : null}
      {status.kind === "password" && !busy ? (
        <View style={{ gap: space.sm }}>
          <Text variant="small" muted>
            This herdlingd is too old to update itself. Herdling can run the installer with one password login.
          </Text>
          <Button
            label="Update herdlingd: sign in once with your password"
            variant="secondary"
            Icon={KeyRound}
            onPress={() => router.push({ pathname: "/hosts/update", params: { id: hostId } })}
          />
        </View>
      ) : null}
      {busy ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <DelayedSpinner color={colors.textMuted} />
          <Text muted style={{ flex: 1 }}>
            Updating herdlingd. The host reconnects when it is done…
          </Text>
        </View>
      ) : null}
      {result ? (
        <Text color={result.ok ? colors.status.done : colors.danger} accessibilityLiveRegion="polite">
          {result.text}
        </Text>
      ) : null}
    </Card>
  );
}
