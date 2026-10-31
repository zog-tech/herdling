import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Check, Copy, LifeBuoy, Plug, Power } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ensureKey } from "../../modules/ssh";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";
import { authorizedKeysCommand } from "./authorizedKeys";
import { LOGIN_HINT, startsAtLogin } from "./boot";
import { herdrNotRunningText, HostNotices } from "./HostNotices";
import { reachFailure } from "./sshHelp";
import { retryNow, useHostConn } from "./connection";
import { UpdateCard } from "./UpdateCard";
import { editPatch } from "./editPatch";
import { DEFAULT_COMMAND, useHosts, type Host } from "./store";

function CopyBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" muted>
        {title}
      </Text>
      <Text variant="caption" mono selectable>
        {text}
      </Text>
      <Button
        label={copied ? "Copied" : `Copy ${title.toLowerCase()}`}
        variant="secondary"
        Icon={copied ? Check : Copy}
        onPress={async () => {
          await Clipboard.setStringAsync(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      />
    </View>
  );
}

/** The pinned host key, so the user can compare it with `ssh-keygen -lf` on the host. */
function HostKey({ fingerprint }: { fingerprint?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" muted>
        Host key
      </Text>
      {fingerprint ? (
        <Text variant="caption" mono selectable accessibilityLabel={`Host key ${fingerprint}`}>
          {fingerprint}
        </Text>
      ) : (
        <Text variant="caption" muted>
          Not pinned yet. The first connection pins it.
        </Text>
      )}
    </View>
  );
}

/** Message for a failed connection. */
function errorMessage(error: string): string {
  return error.startsWith("Host key changed")
    ? "Host key changed. Remove and re-add this host."
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

  return (
    <Screen>
      {host ? <UpdateCard hostId={host.id} /> : null}
      {host ? <HostNotices hostId={host.id} /> : null}
      <Card>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Workstation" autoCapitalize="words" />
        <Field
          label="Address"
          value={address}
          onChangeText={setAddress}
          placeholder="host.example.com"
          keyboardType="url"
        />
        <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" />
        <Field label="User" value={user} onChangeText={setUser} placeholder="sam" />
        <Field label="Command" value={command} onChangeText={setCommand} mono />
        {host ? <HostKey fingerprint={fingerprint} /> : null}
      </Card>

      <Card>
        <Text variant="title">Authorize this phone</Text>
        <Text variant="small" muted>
          Run this command on the host. It adds the phone key, restricted to the Herdling companion.
        </Text>
        {publicKey ? (
          <>
            <CopyBlock title="Command" text={authorizedKeysCommand(publicKey, command)} />
            <CopyBlock title="Public key" text={publicKey} />
          </>
        ) : keyError ? (
          <Text color={colors.danger}>{keyError}</Text>
        ) : (
          <Text muted>Making key…</Text>
        )}
      </Card>

      {tested ? (
        <Card>
          {waiting ? <Text muted>Connecting…</Text> : null}
          {hello ? (
            <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
              <Text bold color={colors.status.done}>
                Connected
              </Text>
              <Text>
                {hello.host} ({hello.os === "macos" ? "macOS" : "Linux"})
              </Text>
              <Text>
                {hello.herdr_ok
                  ? `herdr ok${hello.herdr_version ? ` (${hello.herdr_version})` : ""}`
                  : herdrNotRunningText(hello.host)}
              </Text>
              {/* A new host has no host notices above: show the boot hint here. */}
              {!host && startsAtLogin(hello) && savedId ? (
                <StateNotice
                  Icon={Power}
                  message={LOGIN_HINT}
                  action="How to start at boot"
                  onAction={() => router.push({ pathname: "/hosts/boot-help", params: { id: savedId } })}
                />
              ) : null}
              <HostKey fingerprint={fingerprint} />
            </View>
          ) : null}
          {error ? (
            <Text color={colors.danger} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {error && reach ? (
            <Button
              label="Turn on SSH on the computer"
              variant="secondary"
              Icon={LifeBuoy}
              onPress={() =>
                router.push({
                  pathname: "/hosts/ssh-help",
                  params: { address: address.trim(), port: String(portNum), user: user.trim(), kind: reach },
                })
              }
            />
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <Button
          label="Test connection"
          Icon={Plug}
          loading={waiting}
          disabled={!valid}
          onPress={() => {
            const id = save();
            setTestAttempt(retryNow(id) ?? 0);
          }}
        />
        <Button
          label={host ? "Save" : "Save host"}
          variant="secondary"
          disabled={!valid}
          onPress={() => {
            save();
            router.back();
          }}
        />
      </View>
    </Screen>
  );
}
