import { Check, Download, Trash2, X } from "lucide-react-native";
import { useEffect } from "react";
import { Alert, Switch, View } from "react-native";

import { colors, icon, radius, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Row } from "@/ui/Row";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";

import type { ParakeetModel } from "../../modules/voice/parakeet";
import {
  cancelParakeetDownload,
  deleteParakeet,
  downloadParakeet,
  formatBytes,
  MODEL_BYTES,
  MODEL_LABEL,
  parakeetReady,
  refreshParakeet,
  useParakeet,
} from "./parakeet";
import { inputEngine, useVoiceSettings, type InputEngine } from "./settings";
import { ENGINE_NAME } from "./transcribe";

const MODELS: ParakeetModel[] = ["v2", "v3"];

const DETAIL: Record<InputEngine, string> = {
  parakeet: "Parakeet on this iPhone. Private, works offline. Falls back to Host.",
  host: "The host's stt_command. Falls back to Parakeet when it is downloaded.",
  apple: `${ENGINE_NAME.apple} speech recognition, live while you record.`,
};

/** A thin bar for the download progress, 0..1. The text next to it carries the number too. */
function Progress({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Model download"
      accessibilityValue={{ min: 0, max: 100, now: pct, text: `${pct}%` }}
      style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.raised, overflow: "hidden" }}
    >
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.accent }} />
    </View>
  );
}

function ModelRow({ model }: { model: ParakeetModel }) {
  const status = useParakeet((s) => s.models[model]);
  const downloading = useParakeet((s) => s.downloading);
  const progress = useParakeet((s) => s.progress);
  const chosen = useVoiceSettings((s) => s.parakeetModel === model);
  const allowCellular = useVoiceSettings((s) => s.allowCellular);
  const set = useVoiceSettings((s) => s.set);
  const mine = downloading === model;
  const size = status.installed ? formatBytes(status.bytes) : `about ${formatBytes(MODEL_BYTES[model])}`;

  const confirmDelete = () =>
    Alert.alert(`Delete ${MODEL_LABEL[model]}?`, `This frees ${formatBytes(status.bytes)}. You can download it again later.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteParakeet(model) },
    ]);

  const trailing = mine ? (
    <Button label="Cancel download" iconOnly Icon={X} variant="secondary" onPress={cancelParakeetDownload} />
  ) : status.installed ? (
    <Button label={`Delete ${MODEL_LABEL[model]}`} iconOnly Icon={Trash2} variant="danger" onPress={confirmDelete} />
  ) : (
    <Button
      label="Download"
      Icon={Download}
      variant="secondary"
      disabled={!!downloading}
      onPress={() => {
        haptics.tap();
        void downloadParakeet(model, allowCellular).then((ok) => {
          if (!ok) return;
          haptics.commit();
          // The first model on disk becomes the one in use. A second one waits for a tap on its row.
          const inUse = useVoiceSettings.getState().parakeetModel;
          if (!parakeetReady(useParakeet.getState(), inUse)) set({ parakeetModel: model });
        });
      }}
    />
  );

  return (
    <View style={{ gap: space.xs }}>
      <Row
        accessibilityLabel={`Use ${MODEL_LABEL[model]}`}
        onPress={() => {
          if (!chosen) haptics.tap();
          set({ parakeetModel: model });
        }}
        trailing={trailing}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {chosen ? <Check size={icon.sm} color={colors.accent} accessibilityLabel="Selected" /> : null}
          <Text bold>{MODEL_LABEL[model]}</Text>
        </View>
        <Text variant="small" muted>
          {mine ? `Downloading · ${Math.round(progress * 100)}% of ${formatBytes(MODEL_BYTES[model])}` : status.installed ? `Downloaded · ${size}` : size}
        </Text>
      </Row>
      {mine ? <Progress fraction={progress} /> : null}
    </View>
  );
}

/**
 * Settings > Voice input: the engine (Parakeet, Host, Apple), the Parakeet models with
 * download, progress and delete, and the cellular switch. Builds without FluidAudio hide Parakeet.
 */
export function VoiceInputSection() {
  const { input, parakeetModel, allowCellular, set } = useVoiceSettings();
  const available = useParakeet((s) => s.available);
  const ready = useParakeet((s) => parakeetReady(s, parakeetModel));
  const error = useParakeet((s) => s.error);
  const current = inputEngine(input, ready);
  const engines: InputEngine[] = available ? ["parakeet", "host", "apple"] : ["host", "apple"];
  useEffect(() => {
    void refreshParakeet();
  }, []);
  return (
    <>
      <Text variant="section" accessibilityRole="header">
        VOICE INPUT
      </Text>
      <Card style={{ paddingVertical: space.sm }}>
        <Row
          trailing={
            <View style={{ flexDirection: "row", gap: space.xs }}>
              {engines.map((e) => (
                <Button
                  key={e}
                  label={ENGINE_NAME[e]}
                  variant={current === e ? "primary" : "secondary"}
                  onPress={() => {
                    haptics.tap();
                    set({ input: e });
                  }}
                />
              ))}
            </View>
          }
        >
          <Text bold>Engine</Text>
        </Row>
        <Text variant="small" muted style={{ paddingBottom: space.sm }}>
          {input === "parakeet" && !ready ? `Download a Parakeet model below. Until then, ${ENGINE_NAME.apple} is used.` : DETAIL[current]}
        </Text>
        {available ? (
          <>
            {MODELS.map((m) => (
              <View key={m} style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.sm, paddingBottom: space.xs }}>
                <ModelRow model={m} />
              </View>
            ))}
            {error ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.sm }}>
              <Row
                trailing={
                  <Switch
                    accessibilityLabel="Download over cellular"
                    value={allowCellular}
                    onValueChange={(v) => set({ allowCellular: v })}
                    trackColor={{ false: colors.edge, true: colors.accent }}
          ios_backgroundColor={colors.edge}
                  />
                }
              >
                <Text bold>Download over cellular</Text>
                <Text variant="small" muted>
                  Off: models download on Wi-Fi only.
                </Text>
              </Row>
            </View>
          </>
        ) : null}
      </Card>
    </>
  );
}
