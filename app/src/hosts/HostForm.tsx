import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Check, Copy, Plug } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ensureKey } from "../../modules/ssh";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { authorizedKeysCommand } from "./authorizedKeys";
import { useHostConn } from "./connection";
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

/** Message for a failed connection. */
function errorMessage(error: string): string {
  return error.startsWith("Host key changed")
    ? "Host key changed — remove and re-add this host"
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
  const [tested, setTested] = useState(false);
  const conn = useHostConn(savedId ?? "");

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
    if (savedId && hosts.some((h) => h.id === savedId)) {
      updateHost(savedId, values);
      return savedId;
    }
    const created = addHost(values);
    setSavedId(created.id);
    return created.id;
  };

  const waiting = tested && conn.status === "connecting";
  const hello = tested && conn.status === "online" ? conn.hello : undefined;
  const error = tested && conn.status === "offline" && conn.error ? errorMessage(conn.error) : undefined;

  return (
    <Screen>
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
      </Card>

      <Card>
        <Text variant="title">Authorize this phone</Text>
        <Text variant="small" muted>
          Run this command on the host. It adds the phone key, restricted to the Zogssh companion.
        </Text>
        {publicKey ? (
          <>
            <CopyBlock title="Command" text={authorizedKeysCommand(publicKey)} />
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
              <Text bold color={colors.accent}>
                Connected
              </Text>
              <Text>
                {hello.host} ({hello.os === "macos" ? "macOS" : "Linux"})
              </Text>
              <Text>
                {hello.herdr_ok ? `herdr ok${hello.herdr_version ? ` (${hello.herdr_version})` : ""}` : "herdr not running"}
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text color={colors.danger} accessibilityLiveRegion="polite">
              {error}
            </Text>
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
            save();
            setTested(true);
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
