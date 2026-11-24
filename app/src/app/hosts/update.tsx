import { useLocalSearchParams, useRouter } from "expo-router";
import { CircleAlert, ExternalLink, KeyRound } from "lucide-react-native";
import { useState } from "react";
import { Linking } from "react-native";

import { Lead, Outcome, Working } from "@/hosts/flowParts";
import { HERDR_URL } from "@/hosts/installer";
import { useHosts } from "@/hosts/store";
import { updateWithPassword } from "@/hosts/updates";
import { colors, icon } from "@/theme/tokens";
import { ActionBar } from "@/ui/ActionBar";
import { Field } from "@/ui/Field";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";

/**
 * Updates a herdlingd that is too old to update itself: one password login runs the installer,
 * pinned to the saved host key. The password is used for this one login and is not kept.
 */
export default function UpdateWithPasswordScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();

  if (!host)
    return (
      <Screen>
        <StateNotice Icon={CircleAlert} message="Computer not found." />
      </Screen>
    );

  const run = async () => {
    if (busy || password === "") return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await updateWithPassword(host, password);
      if (r.ok) setDone(`herdlingd ${r.version} is installed. ${host.name} reconnects now.`);
      else setError(r.message);
    } catch {
      setError("The update failed.");
    } finally {
      // The password is used for one attempt only.
      setPassword("");
      setBusy(false);
    }
  };

  const footer = done ? (
    <ActionBar primary={{ label: "Done", onPress: () => router.back() }} />
  ) : (
    <ActionBar
      keyboard
      primary={{ label: "Update herdlingd", Icon: KeyRound, loading: busy, disabled: password === "" || !host.fingerprint, onPress: () => void run() }}
    />
  );

  return (
    <Screen flush footer={footer}>
      <Lead>
        Herdling logs in to {host.user}@{host.address} once with your SSH password and runs the herdlingd installer. It
        downloads the latest herdlingd from GitHub, checks it, installs it to ~/.local/bin and restarts the user service.
        No admin rights. The password is not kept.
      </Lead>
      {host.fingerprint ? null : <Outcome ok={false} text="The host key is not pinned yet. Connect the computer once first." />}
      {done ? null : (
        <Section title="Login" footer="The password is used for this update only.">
          <Group>
            <Pad>
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="off"
                importantForAutofill="no"
                editable={!busy}
                onSubmitEditing={() => void run()}
              />
            </Pad>
          </Group>
        </Section>
      )}
      {busy ? <Working text="Installing herdlingd. This can take a minute…" /> : null}
      {error ? <Outcome ok={false} text={error} /> : null}
      {error?.includes(HERDR_URL) ? (
        <Section title="Help">
          <Group>
            <Row
              title="Open herdr.dev"
              leading={<ExternalLink size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
              onPress={() => void Linking.openURL(HERDR_URL)}
            />
          </Group>
        </Section>
      ) : null}
      {done ? <Outcome ok text={done} /> : null}
    </Screen>
  );
}
