import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Check, Copy, LifeBuoy, Plug, Power, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";

import { ensureKey } from "../../modules/ssh";
import { publicKeyFingerprint } from "@/pairing/keyFingerprint";
import { PhoneKey } from "@/pairing/PhoneKey";
import { useMirrorSupported } from "@/mirror/useMirror";
import { colors, icon } from "@/theme/tokens";
import { ActionBar } from "@/ui/ActionBar";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";
import { authorizedKeysCommand } from "./authorizedKeys";
import { LOGIN_HINT, startsAtLogin } from "./boot";
import { runtimeDownText } from "./coreInstall";
import { HostNotices } from "./HostNotices";
import { DevicesRow } from "./DevicesRow";
import { IntegrationsRow, useIntegrationsShown } from "./IntegrationsRow";
import { KeyRow, Outcome, Working } from "./flowParts";
import { confirmRemoveHost } from "./removeHost";
import { reachFailure } from "./sshHelp";
import { retryNow, useHostConn } from "./connection";
import { CoreCard } from "./CoreCard";
import { HerdrUpdateCard } from "./HerdrUpdateCard";
import { UpdateCard } from "./UpdateCard";
import { editPatch } from "./editPatch";
import { DEFAULT_COMMAND, useHosts, type Host } from "./store";

/** A text to copy (a command, a key) as a row: the title, the text in mono, and a copy button. */
function CopyRow({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Row
      title={title}
      trailing={
        <Button
          label={copied ? "Copied" : `Copy ${title.toLowerCase()}`}
          variant="secondary"
          iconOnly
          Icon={copied ? Check : Copy}
          onPress={async () => {
            await Clipboard.setStringAsync(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        />
      }
    >
      <Text variant="caption" mono selectable>
        {text}
      </Text>
    </Row>
  );
}

const HOST_KEY_EMPTY = "Not pinned yet. The first connection pins it.";

/** Message for a failed connection. */
function errorMessage(error: string): string {
  return error.startsWith("Host key changed")
    ? "Host key changed. Remove and re-add this computer."
    : error;
}

/** Add or edit a host. With `host` set the form edits it. */
export function HostForm({ host }: { host?: Host }) {
  const router = useRouter();
  const [savedId, setSavedId] = useState(host?.id);
  const [name, setName] = useState(host?.name ?? "");
  const [address, setAddress] = useState(host?.address ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [user, setUser] = useState(host?.user ?? "");
  const [command, setCommand] = useState(host?.command ?? DEFAULT_COMMAND);
  const [publicKey, setPublicKey] = useState<string>();
  const [keyError, setKeyError] = useState<string>();
  /** Attempt number of the last Test press. Results of earlier attempts are ignored. */
  const [testAttempt, setTestAttempt] = useState<number>();
  const conn = useHostConn(savedId ?? "");
  const fingerprint = useHosts((s) => s.hosts.find((h) => h.id === savedId)?.fingerprint);
  const integrations = useIntegrationsShown(host?.id ?? "");
  const devices = useMirrorSupported(host?.id ?? "");

  useEffect(() => {
    ensureKey().then(
      (k) => setPublicKey(k.publicKey),
      (e) => setKeyError(String(e?.message ?? e)),
    );
  }, []);

  const portNum = Number(port);
  const portOk = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const valid = name.trim() !== "" && address.trim() !== "" && user.trim() !== "" && portOk;

  /** Saves the form values and returns the host id. */
  const save = (): string => {
    const values = {
      name: name.trim(),
      address: address.trim(),
      port: portNum,
      user: user.trim(),
      command: command.trim() || DEFAULT_COMMAND,
    };
    const { hosts, addHost, updateHost } = useHosts.getState();
    const old = savedId ? hosts.find((h) => h.id === savedId) : undefined;
    if (savedId && old) {
      updateHost(savedId, editPatch(old, values));
      return savedId;
    }
    const created = addHost(values);
    setSavedId(created.id);
    return created.id;
  };

  const tested = testAttempt !== undefined;
  const fresh = tested && conn.attempt >= testAttempt;
  const waiting = tested && (!fresh || conn.status === "connecting");
  const hello = fresh && conn.status === "online" ? conn.hello : undefined;
  const error = fresh && conn.status === "offline" && conn.error ? errorMessage(conn.error) : undefined;
  const reach = error ? reachFailure(conn.errorCode, conn.error ?? "") : null;

  const testButton = {
    label: "Test connection",
    Icon: Plug,
    loading: waiting,
    disabled: !valid,
    onPress: () => {
      const id = save();
      setTestAttempt(retryNow(id) ?? 0);
    },
  };
  const saveButton = {
    label: host ? "Save" : "Save computer",
    disabled: !valid,
    onPress: () => {
      save();
      router.back();
    },
  };
  const phoneFingerprint = publicKey ? (publicKeyFingerprint(publicKey) ?? undefined) : undefined;
  const bootHint = !!hello && !host && startsAtLogin(hello) && !!savedId;

  return (
    <Screen flush footer={<ActionBar primary={testButton} secondary={saveButton} />}>
      {host ? <UpdateCard hostId={host.id} /> : null}
      {host ? <HerdrUpdateCard hostId={host.id} /> : null}
      {host ? <CoreCard hostId={host.id} /> : null}
      {host ? <HostNotices hostId={host.id} /> : null}
      {host && (integrations || devices) ? (
        <Section title="Tools">
          <Group>
            {integrations ? <IntegrationsRow hostId={host.id} /> : null}
            {devices ? <DevicesRow hostId={host.id} /> : null}
          </Group>
        </Section>
      ) : null}

      <Section title="Connection">
        <Group>
          <Pad>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Workstation" autoCapitalize="words" />
            <Field label="Address" value={address} onChangeText={setAddress} placeholder="host.example.com" keyboardType="url" />
            <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" />
            <Field label="User" value={user} onChangeText={setUser} placeholder="sam" />
            <Field label="Command" value={command} onChangeText={setCommand} mono />
          </Pad>
          {host ? <KeyRow title="Host key" fingerprint={fingerprint} empty={HOST_KEY_EMPTY} /> : null}
        </Group>
      </Section>

      {tested ? (
        <Section title="Test">
          <Group>
            {waiting ? (
              <Pad>
                <Working bare text="Connecting…" />
              </Pad>
            ) : null}
            {hello ? (
              <Pad>
                <Outcome bare ok text="Connected" />
                <Text>
                  {hello.host} ({hello.os === "macos" ? "macOS" : "Linux"})
                </Text>
                <Text variant="small" muted>
                  {hello.herdr_ok ? `herdr ok${hello.herdr_version ? ` (${hello.herdr_version})` : ""}` : runtimeDownText(hello.host, hello)}
                </Text>
                {/* A new host has no host notices above: show the boot hint here. */}
                {bootHint ? <StateNotice inline Icon={Power} message={LOGIN_HINT} /> : null}
              </Pad>
            ) : null}
            {bootHint && savedId ? (
              <Row title="How to start at boot" chevron onPress={() => router.push({ pathname: "/hosts/boot-help", params: { id: savedId } })} />
            ) : null}
            {hello ? <KeyRow title="Host key" fingerprint={fingerprint} empty={HOST_KEY_EMPTY} /> : null}
            {error ? (
              <Pad>
                <Outcome bare ok={false} text={error} />
              </Pad>
            ) : null}
            {error && reach ? (
              <Row
                title="Turn on SSH on the computer"
                leading={<LifeBuoy size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
                chevron
                onPress={() =>
                  router.push({
                    pathname: "/hosts/ssh-help",
                    params: { address: address.trim(), port: String(portNum), user: user.trim(), kind: reach },
                  })
                }
              />
            ) : null}
          </Group>
        </Section>
      ) : null}

      <Section title="Authorize this phone" footer="Run this command on the computer. It adds the phone key, restricted to the Herdling companion.">
        <Group>
          {publicKey ? <CopyRow title="Command" text={authorizedKeysCommand(publicKey, command)} /> : null}
          {publicKey ? <CopyRow title="Public key" text={publicKey} /> : null}
          {phoneFingerprint ? <PhoneKey fingerprint={phoneFingerprint} /> : null}
          {!publicKey && keyError ? (
            <Pad>
              <Outcome bare ok={false} text={keyError} />
            </Pad>
          ) : null}
          {!publicKey && !keyError ? (
            <Pad>
              <Working bare text="Making key…" />
            </Pad>
          ) : null}
        </Group>
      </Section>

      {host ? (
        <Section>
          <Group>
            <Row
              title={`Remove ${host.name}`}
              destructive
              leading={<Trash2 size={icon.md} color={colors.danger} strokeWidth={icon.strokeWidth} />}
              accessibilityLabel={`Remove ${host.name}`}
              accessibilityHint="Asks first, then deletes the computer and its pinned key from this phone"
              onPress={() => void confirmRemoveHost(host, () => router.back())}
            />
          </Group>
        </Section>
      ) : null}
    </Screen>
  );
}