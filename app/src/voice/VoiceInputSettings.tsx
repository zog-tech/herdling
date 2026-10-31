import { Check, Download, Trash2, X, type LucideIcon } from "lucide-react-native";
import { useEffect } from "react";
import { Alert, Pressable, View } from "react-native";

import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { GoldSwitch } from "@/ui/GoldSwitch";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Segmented } from "@/ui/Segmented";
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

const MODELS: ParakeetModel[] = ["v2", "v3"];

const DETAIL: Record<InputEngine, string> = {
  parakeet: "Parakeet on this iPhone. Private, works offline. Falls back to Host.",
  host: "The host's stt_command. Falls back to Parakeet when it is downloaded.",
  apple: "Apple speech recognition, live while you record.",
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

/** A quiet round icon button (download, cancel, delete): a filled circle, no edge, 44 pt target. */
function IconAction({
  label,
  Icon,
  onPress,
  color = colors.text,
  disabled,
}: {
  label: string;
  Icon: LucideIcon;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: disabled ? state.disabledOpacity : 1 }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.divider : colors.raised,
          }}
        >
          <Icon size={icon.sm} color={color} strokeWidth={icon.strokeWidth} />
        </View>
      )}
    </Pressable>
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
    <IconAction label="Cancel download" Icon={X} onPress={cancelParakeetDownload} />
  ) : status.installed ? (
    <IconAction label={`Delete ${MODEL_LABEL[model]}`} Icon={Trash2} color={colors.danger} onPress={confirmDelete} />
  ) : (
    <IconAction
      label={`Download ${MODEL_LABEL[model]}`}
      Icon={Download}
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
    <Row
      accessibilityLabel={`Use ${MODEL_LABEL[model]}${chosen ? ", selected" : ""}`}
      onPress={() => {
        if (!chosen) haptics.tap();
        set({ parakeetModel: model });
      }}
      leading={
        // The check marks the model in use; the empty box keeps the titles in one column.
        <View style={{ width: icon.md }}>{chosen ? <Check size={icon.md} color={colors.accent} accessibilityLabel="Selected" /> : null}</View>
      }
      title={MODEL_LABEL[model]}
      detail={mine ? `Downloading · ${Math.round(progress * 100)}% of ${formatBytes(MODEL_BYTES[model])}` : status.installed ? `Downloaded · ${size}` : size}
      trailing={trailing}
      below={mine ? <Progress fraction={progress} /> : undefined}
    />
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
  const label: Record<InputEngine, string> = { parakeet: "Parakeet", host: "Host", apple: "Apple" };
  return (
    <Section title="Voice input">
      <Group>
        <Row
          title="Engine"
          detail={input === "parakeet" && !ready ? "Download a Parakeet model below. Until then, Apple is used." : DETAIL[current]}
          below={
            <Segmented
              options={engines.map((e) => ({ id: e, label: label[e] }))}
              value={current}
              onChange={(e) => set({ input: e })}
              label="Voice input engine"
            />
          }
        />
        {available ? MODELS.map((m) => <ModelRow key={m} model={m} />) : null}
        {available && error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
            {error}
          </Text>
        ) : null}
        {available ? (
          <Row
            title="Download over cellular"
            detail="Off: models download on Wi-Fi only."
            trailing={<GoldSwitch label="Download over cellular" value={allowCellular} onValueChange={(v) => set({ allowCellular: v })} />}
          />
        ) : null}
      </Group>
    </Section>
  );
}
