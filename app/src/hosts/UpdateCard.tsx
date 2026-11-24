import { useRouter } from "expo-router";
import { ArrowUpCircle, KeyRound } from "lucide-react-native";
import { useState } from "react";
import { Alert } from "react-native";

import { colors, icon } from "@/theme/tokens";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Text } from "@/ui/Text";

import { Outcome, Working } from "./flowParts";
import { useHostConn } from "./connection";
import { useHosts } from "./store";
import { coreUpdateNote } from "./coreInstall";
import { applyUpdate, updateStatus } from "./updates";

/** Longest part of the release notes in the confirmation. */
const NOTES_LIMIT = 600;

function confirmUpdate(from: string, to: string, notes: string, coreNote?: string): Promise<boolean> {
  const text = (coreNote ? `\n\n${coreNote}` : "") + (notes.trim() ? `\n\n${notes.trim().slice(0, NOTES_LIMIT)}` : "");
  return new Promise((resolve) => {
    Alert.alert(
      `Update herdlingd to ${to}?`,
      `The computer runs ${from}. herdlingd downloads ${to} from GitHub, checks it and restarts. The connection drops for a moment.${text}`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Update", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** The "herdlingd" band of the host screen: the version and its update. Nothing while the host is offline. */
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

  const coreNote = status.kind === "available" ? coreUpdateNote(status.core) : undefined;
  const update = async (from: string, to: string, notes: string) => {
    if (busy || !(await confirmUpdate(from, to, notes, coreNote))) return;
    setBusy(true);
    setResult(undefined);
    try {
      const r = await applyUpdate(hostId);
      const text = r.status === "up_to_date" ? `herdlingd ${r.version} is up to date.` : `herdlingd ${r.version} is running.`;
      setResult({ ok: true, text: r.notice ? `${text} ${r.notice}` : text });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "The update failed." });
    } finally {
      setBusy(false);
    }
  };

  const upToDate = status.kind === "none" && !!hello && host.updateCheck?.current === hello.herdlingd && !host.updateCheck.updateAvailable;

  return (
    <Section title="herdlingd">
      <Group>
        {hello ? <Row title="Version" detail={upToDate ? "Up to date" : undefined} trailing={<Text muted>{hello.herdlingd}</Text>} /> : null}
        {status.kind === "available" && !busy ? (
          <Row
            title="Update herdlingd"
            detail={`${status.from} → ${status.to}`}
            leading={<ArrowUpCircle size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
            accessibilityLabel={`Update herdlingd from ${status.from} to ${status.to}`}
            onPress={() => void update(status.from, status.to, status.notes)}
          />
        ) : null}
        {status.kind === "available" && !busy && (coreNote || status.notes.trim()) ? (
          <Pad>
            {coreNote ? (
              <Text variant="small" color={colors.status.blocked}>
                {coreNote}
              </Text>
            ) : null}
            {status.notes.trim() ? (
              <Text variant="small" muted numberOfLines={6}>
                {status.notes.trim()}
              </Text>
            ) : null}
          </Pad>
        ) : null}
        {status.kind === "password" && !busy ? (
          <Row
            title="Update with your password"
            detail="This herdlingd is too old to update itself. Herdling can run the installer with one password login."
            leading={<KeyRound size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
            accessibilityLabel="Update herdlingd: sign in once with your password"
            chevron
            onPress={() => router.push({ pathname: "/hosts/update", params: { id: hostId } })}
          />
        ) : null}
        {busy ? (
          <Pad>
            <Working bare text="Updating herdlingd. The computer reconnects when it is done…" />
          </Pad>
        ) : null}
        {result ? (
          <Pad>
            <Outcome bare ok={result.ok} text={result.text} />
          </Pad>
        ) : null}
      </Group>
    </Section>
  );
}
