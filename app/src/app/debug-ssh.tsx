import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ensureKey } from "../../modules/ssh";
import { startConnections, useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { colors, space, type } from "@/theme/tokens";

const DEBUG_HOST_ID = "debug";

/**
 * Development-only screen to drive the ssh module before the Settings UI exists.
 * Open `zogssh://debug-ssh` to show the phone key, or
 * `zogssh://debug-ssh?host=<addr>&port=22&user=<name>[&fingerprint=SHA256:...]` to save a "debug" host and connect it.
 */
export default function DebugSshScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DebugSsh />;
}

function DebugSsh() {
  const params = useLocalSearchParams<{ host?: string; port?: string; user?: string; fingerprint?: string }>();
  const [publicKey, setPublicKey] = useState<string>();
  const conn = useHostConn(DEBUG_HOST_ID);
  const host = useHosts((s) => s.hosts.find((h) => h.id === DEBUG_HOST_ID));

  useEffect(() => {
    ensureKey().then(({ publicKey }) => {
      console.log("[debug-ssh] public key:", publicKey);
      setPublicKey(publicKey);
    });
  }, []);

  useEffect(() => {
    if (!params.host || !params.user) return;
    const { hosts, addHost, updateHost } = useHosts.getState();
    const entry = { address: params.host, port: Number(params.port ?? 22), user: params.user };
    // `fingerprint` overrides the pin (used to check the mismatch path).
    if (params.fingerprint) Object.assign(entry, { fingerprint: params.fingerprint });
    if (hosts.some((h) => h.id === DEBUG_HOST_ID)) updateHost(DEBUG_HOST_ID, entry);
    else addHost({ id: DEBUG_HOST_ID, name: "Debug", ...entry });
    startConnections();
  }, [params.host, params.port, params.user, params.fingerprint]);

  useEffect(() => {
    console.log("[debug-ssh] conn:", conn.status, conn.error ?? "", conn.hello ? JSON.stringify(conn.hello) : "");
  }, [conn]);

  const line = { color: colors.text, fontSize: type.size.small, marginBottom: space.md } as const;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <Text style={line} selectable>
          key: {publicKey ?? "…"}
        </Text>
        <Text style={line}>host: {host ? `${host.user}@${host.address}:${host.port} ${host.fingerprint ?? ""}` : "none"}</Text>
        <Text style={line}>status: {conn.status}</Text>
        {conn.error ? <Text style={{ ...line, color: colors.danger }}>error: {conn.error}</Text> : null}
        {conn.hello ? <Text style={line}>hello: {JSON.stringify(conn.hello)}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
