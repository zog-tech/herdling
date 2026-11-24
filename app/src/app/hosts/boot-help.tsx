import type { Boot } from "@herdling/protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MonitorUp, RefreshCw } from "lucide-react-native";
import { useState } from "react";

import {
  bootCase,
  bootOf,
  bootResultText,
  bootSteps,
  canOpenMacSettings,
  checkBoot,
  FILEVAULT_OFF_NOTE,
  HERDR_BOOT_NOTE,
  openMacSettings,
  paneFor,
} from "@/hosts/boot";
import { useHostConn } from "@/hosts/connection";
import { listsMethod } from "@/hosts/methods";
import { useHosts } from "@/hosts/store";
import { Lead, Outcome } from "@/hosts/flowParts";
import { Walkthrough } from "@/hosts/Walkthrough";
import { ActionBar } from "@/ui/ActionBar";
import { Group, Pad, Section } from "@/ui/Group";
import { Screen } from "@/ui/Screen";

/**
 * "How to start at boot": a guided walkthrough for automatic login on a Mac (or the FileVault
 * case) and lingering on Linux. "Done, check again" calls `boot.check`. On a Mac with a current
 * herdlingd, "Open this setting on my Mac" shows the right System Settings page on the Mac screen.
 * Params: `id` (the host), and `os` for a host that is not connected yet.
 */
export default function BootHelpScreen() {
  const router = useRouter();
  const p = useLocalSearchParams<{ id?: string; os?: string }>();
  const id = p.id ?? "";
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  const conn = useHostConn(id);
  const hello = conn.status === "online" ? conn.hello : undefined;
  const [checked, setChecked] = useState<Boot>();
  const [busy, setBusy] = useState<"check" | "open">();
  const [note, setNote] = useState<{ ok: boolean; text: string }>();

  const boot = checked ?? bootOf(hello ?? conn.hello);
  const os = hello?.os ?? conn.hello?.os ?? (p.os === "linux" ? "linux" : "macos");
  const c = bootCase(os, boot);
  const steps = bootSteps(c, boot?.user);
  const pane = paneFor(c);
  const name = host?.name ?? "the computer";
  const rpc = conn.status === "online" ? conn.rpc : undefined;
  const canCheck = !!rpc && listsMethod(hello, "boot.check");

  const recheck = async () => {
    if (!rpc || busy) return;
    setBusy("check");
    setNote(undefined);
    try {
      const b = await checkBoot(rpc);
      setChecked(b);
      setNote(bootResultText(b));
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "The check failed." });
    } finally {
      setBusy(undefined);
    }
  };

  const open = async () => {
    if (!rpc || !pane || busy) return;
    setBusy("open");
    setNote(undefined);
    try {
      await openMacSettings(rpc, pane);
      setNote({ ok: true, text: `System Settings is open on ${name}. Do the steps there.` });
    } catch (e) {
      setNote({ ok: false, text: `Cannot open System Settings on ${name}. ${e instanceof Error ? e.message : ""}`.trim() });
    } finally {
      setBusy(undefined);
    }
  };

  const title = c === "mac_filevault" ? "Automatic login is not possible" : "Start at boot";
  const lead =
    c === "linux_linger"
      ? `herdlingd runs as a user service. On Linux it starts at your login, or at boot when lingering is on. Do these steps on ${name}.`
      : c === "mac_filevault"
        ? `herdlingd starts when you log in on ${name}.`
        : `herdlingd starts when you log in on ${name}. With automatic login, the Mac logs you in when it starts, so herdlingd starts too.`;

  const openOnMac = pane && rpc && canOpenMacSettings(hello);
  const secondary = openOnMac
    ? { label: "Open this setting on my Mac", Icon: MonitorUp, loading: busy === "open", onPress: () => void open() }
    : undefined;
  const footer =
    checked?.starts_at === "boot" ? (
      <ActionBar primary={{ label: "Close", onPress: () => router.back() }} />
    ) : canCheck ? (
      <ActionBar primary={{ label: "Done, check again", Icon: RefreshCw, loading: busy === "check", onPress: () => void recheck() }} secondary={secondary} />
    ) : (
      <ActionBar primary={{ label: "Close", onPress: () => router.back() }} secondary={secondary} />
    );

  return (
    <Screen flush footer={footer}>
      <Section title={title}>
        <Lead>{lead}</Lead>
      </Section>
      <Section title="Steps" footer={c === "mac_filevault" ? FILEVAULT_OFF_NOTE : undefined}>
        <Group>
          <Pad>
            <Walkthrough steps={steps} />
          </Pad>
        </Group>
      </Section>
      <Lead>{HERDR_BOOT_NOTE}</Lead>
      {note ? <Outcome ok={note.ok} text={note.text} /> : null}
      {checked?.starts_at === "boot" || canCheck ? null : (
        <Lead>{rpc ? "Update herdlingd on this computer to check from the phone." : `Herdling checks again when ${name} is connected.`}</Lead>
      )}
    </Screen>
  );
}
