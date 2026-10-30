import { useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { Minus, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";

import { ConnBadge, timeAgo } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { confirmRemoveHost } from "@/hosts/removeHost";
import { useHosts, type Host } from "@/hosts/store";
import { useNotifPrefs } from "@/push/prefs";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useVoiceSettings } from "@/voice/settings";

function HostRow({ host }: { host: Host }) {
  const router = useRouter();
  const conn = useHostConn(host.id);
  return (
    <Row
      accessibilityLabel={`Edit ${host.name}`}
      onPress={() => router.push({ pathname: "/hosts/[id]", params: { id: host.id } })}
      trailing={<Button label={`Remove ${host.name}`} iconOnly variant="danger" Icon={Trash2} onPress={() => confirmRemoveHost(host)} />}
    >
      <Text bold>{host.name}</Text>
      <Text variant="small" muted mono>
        {host.user}@{host.address}
        {host.port === 22 ? "" : `:${host.port}`}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs }}>
        <ConnBadge status={conn.status} />
        {conn.lastSeen ? (
          <Text variant="caption" muted>
            Seen {timeAgo(conn.lastSeen)}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

function PrefRow({ pref, label, detail }: { pref: "finished" | "needs_you"; label: string; detail: string }) {
  const value = useNotifPrefs((s) => s[pref]);
  const setPref = useNotifPrefs((s) => s.setPref);
  return (
    <Row
      trailing={
        <Switch
          accessibilityLabel={label}
          value={value}
          onValueChange={(v) => setPref(pref, v)}
          trackColor={{ false: colors.muted, true: colors.accent }}
        />
      }
    >
      <Text bold>{label}</Text>
      <Text variant="small" muted>
        {detail}
      </Text>
    </Row>
  );
}

const RATE_STEP = 0.1;
const RATE_MIN = 0.5;
const RATE_MAX = 2;

/** Voices for the device language, enhanced first. */
function useDeviceVoices(): Speech.Voice[] {
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  useEffect(() => {
    let live = true;
    const lang = Intl.DateTimeFormat().resolvedOptions().locale.split(/[-_]/)[0].toLowerCase();
    Speech.getAvailableVoicesAsync()
      .then((all) => {
        if (!live) return;
        const mine = all.filter((v) => v.language.toLowerCase().startsWith(lang));
        const rank = (v: Speech.Voice) => (v.quality === Speech.VoiceQuality.Enhanced ? 0 : 1);
        setVoices(mine.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return voices;
}

function VoiceSection() {
  const { ttsDefault, mode, engine, voice, rate, set } = useVoiceSettings();
  const voices = useDeviceVoices();
  const [picking, setPicking] = useState(false);
  const current = voices.find((v) => v.identifier === voice);
  const setRate = (r: number) => set({ rate: Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) * 10) / 10 });
  return (
    <>
      <Text variant="small" muted>
        VOICE
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        <Row
          trailing={
            <Switch
              accessibilityLabel="Speak replies by default"
              value={ttsDefault}
              onValueChange={(v) => set({ ttsDefault: v })}
              trackColor={{ false: colors.muted, true: colors.accent }}
            />
          }
        >
          <Text bold>Speak replies</Text>
          <Text variant="small" muted>
            Default for new sessions. Each session has its own speaker button.
          </Text>
        </Row>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm }}>
          <Row
            trailing={
              <View style={{ flexDirection: "row", gap: space.xs }}>
                <Button label="Full" variant={mode === "full" ? "primary" : "secondary"} onPress={() => set({ mode: "full" })} />
                <Button label="Summary" variant={mode === "summary" ? "primary" : "secondary"} onPress={() => set({ mode: "summary" })} />
              </View>
            }
          >
            <Text bold>Mode</Text>
            <Text variant="small" muted>
              Summary: on-device (Apple Intelligence) → host command → full text.
            </Text>
          </Row>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm }}>
          <Row
            trailing={
              <View style={{ flexDirection: "row", gap: space.xs }}>
                <Button
                  label="iPhone"
                  variant={engine === "iphone" ? "primary" : "secondary"}
                  onPress={() => set({ engine: "iphone" })}
                />
                <Button
                  label="Host"
                  variant={engine === "host" ? "primary" : "secondary"}
                  onPress={() => set({ engine: "host" })}
                />
              </View>
            }
          >
            <Text bold>Voice engine</Text>
            <Text variant="small" muted>
              {engine === "host" ? "Host voice command (tts_command). Falls back to iPhone voices." : "iPhone voices."}
            </Text>
          </Row>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm }}>
          <Row
            accessibilityLabel="Choose voice"
            onPress={() => setPicking((p) => !p)}
            trailing={
              <Text variant="small" muted>
                {current?.name ?? "System default"}
              </Text>
            }
          >
            <Text bold>Voice</Text>
          </Row>
          {picking ? (
            <View>
              <Row accessibilityLabel="System default voice" onPress={() => (set({ voice: undefined }), setPicking(false))}>
                <Text>System default</Text>
              </Row>
              {voices.map((v) => (
                <Row
                  key={v.identifier}
                  accessibilityLabel={`Voice ${v.name}`}
                  onPress={() => (set({ voice: v.identifier }), setPicking(false))}
                  trailing={
                    v.quality === Speech.VoiceQuality.Enhanced ? (
                      <Text variant="caption" muted>
                        Enhanced
                      </Text>
                    ) : undefined
                  }
                >
                  <Text bold={v.identifier === voice}>{v.name}</Text>
                </Row>
              ))}
            </View>
          ) : null}
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm }}>
          <Row
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Button label="Slower" iconOnly Icon={Minus} variant="secondary" onPress={() => setRate(rate - RATE_STEP)} />
                <Text mono style={{ minWidth: 40, textAlign: "center" }}>
                  {rate.toFixed(1)}x
                </Text>
                <Button label="Faster" iconOnly Icon={Plus} variant="secondary" onPress={() => setRate(rate + RATE_STEP)} />
              </View>
            }
          >
            <Text bold>Speed</Text>
          </Row>
        </View>
      </Card>
    </>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  return (
    <Screen>
      <Text variant="small" muted>
        HOSTS
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        {hosts.length === 0 ? (
          <Text muted style={{ paddingVertical: space.md }}>
            No hosts yet. Add one to get started.
          </Text>
        ) : (
          hosts.map((h, i) => (
            <View
              key={h.id}
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm } : undefined}
            >
              <HostRow host={h} />
            </View>
          ))
        )}
      </Card>
      <Button label="Add host" Icon={Plus} onPress={() => router.push("/hosts/discover")} />
      <Text variant="small" muted>
        NOTIFICATIONS
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        <PrefRow pref="finished" label="Finished" detail="An agent finished its turn." />
        <View style={{ borderTopWidth: 1, borderTopColor: colors.muted, paddingTop: space.sm }}>
          <PrefRow pref="needs_you" label="Needs you" detail="An agent waits for your input." />
        </View>
      </Card>
      <VoiceSection />
    </Screen>
  );
}
