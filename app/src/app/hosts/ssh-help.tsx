import { useLocalSearchParams, useRouter } from "expo-router";
import { RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { probeHostKey } from "../../../modules/ssh";
import { linuxSshSteps, macRemoteLoginSteps, NETWORK_STEP, reachFailure, reachLead, type ReachFailure } from "@/hosts/sshHelp";
import { Walkthrough } from "@/hosts/Walkthrough";
import { Lead, Outcome } from "@/hosts/flowParts";
import { space } from "@/theme/tokens";
import { ActionBar } from "@/ui/ActionBar";
import { Group, Pad, Section } from "@/ui/Group";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";

const SYSTEMS = [
  { id: "macos", label: "Mac" },
  { id: "linux", label: "Linux" },
] as const;

const KINDS: readonly ReachFailure[] = ["refused", "no_route", "no_answer", "other"];

type Check = { ok: true } | { ok: false; kind: ReachFailure };

/**
 * "Turn on SSH on the computer": a guided walkthrough for Remote Login on a Mac and the SSH server
 * on Linux. "Done, check again" opens a test connection that reads only the host key (no login).
 * Params: `address`, `port`, and optional `user`, `kind` (a `ReachFailure`) and `os`.
 */
export default function SshHelpScreen() {
  const router = useRouter();
  const p = useLocalSearchParams<{ address?: string; port?: string; user?: string; kind?: string; os?: string }>();
  const address = (p.address ?? "").trim();
  const port = Number(p.port) || 22;
  const user = p.user?.trim() || undefined;
  const firstKind = KINDS.find((k) => k === p.kind);
  const [os, setOs] = useState<"macos" | "linux">(p.os === "linux" ? "linux" : "macos");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<Check>();
  const target = address ? (port === 22 ? address : `${address}:${port}`) : "the computer";
  const kind = check && !check.ok ? check.kind : firstKind;

  const recheck = async () => {
    if (!address || checking) return;
    setChecking(true);
    setCheck(undefined);
    try {
      await probeHostKey({ host: address, port, timeoutMs: 10_000 });
      setCheck({ ok: true });
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      const text = (e as { message?: unknown } | null)?.message;
      setCheck({ ok: false, kind: reachFailure(code, typeof text === "string" ? text : "") ?? "other" });
    } finally {
      setChecking(false);
    }
  };

  const steps = [...(os === "macos" ? macRemoteLoginSteps(user) : linuxSshSteps()), NETWORK_STEP];

  const footer = check?.ok ? (
    <ActionBar primary={{ label: "Back to setup", onPress: () => router.back() }} />
  ) : (
    <ActionBar
      primary={{ label: "Done, check again", Icon: RefreshCw, loading: checking, disabled: !address, onPress: () => void recheck() }}
      secondary={{ label: "Back", onPress: () => router.back() }}
    />
  );

  return (
    <Screen flush footer={footer}>
      <Lead>{reachLead(kind, target)}</Lead>
      <View style={{ paddingHorizontal: space.lg }}>
        <Segmented options={SYSTEMS} value={os} onChange={setOs} label="The system of the computer" />
      </View>
      <Section title="Steps">
        <Group>
          <Pad>
            <Walkthrough steps={steps} />
          </Pad>
        </Group>
      </Section>
      {check ? (
        <View style={{ gap: space.xs }}>
          <Outcome ok={check.ok} text={check.ok ? `SSH is on. The phone reached ${target}.` : "Still no SSH connection."} />
          {!check.ok ? <Lead>{reachLead(check.kind, target)}</Lead> : null}
        </View>
      ) : null}
    </Screen>
  );
}
