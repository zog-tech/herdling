import type { AgentsInstalled } from "@herdling/protocol";
import { Bot } from "lucide-react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { AgentMark } from "@/ui/AgentMark";
import { PickerRow } from "@/ui/PickerRow";
import type { PickerOption } from "@/ui/PickerSheet";
import { TerminalMark } from "@/ui/TerminalMark";

import { availability, pickerChoices, SHELL_CHOICE } from "./installed";

/** The detail of an agent that the computer reports as not installed. */
export const NOT_INSTALLED = "Not installed";

/**
 * The choices of the agent picker: Shell first, then the agents. An agent that the computer
 * reports as not installed goes to the end with "Not installed" as its detail. It stays a choice,
 * because the check can miss a custom PATH.
 */
export function agentOptions(installed: AgentsInstalled | undefined): PickerOption<string>[] {
  return pickerChoices(installed).map((k) => {
    const shell = k === SHELL_CHOICE;
    const missing = !shell && availability(k, installed) === "missing";
    return {
      value: k,
      label: shell ? "Shell" : agentLabel(k),
      detail: shell ? "A terminal with no agent" : missing ? NOT_INSTALLED : undefined,
      leading: shell ? <TerminalMark /> : <AgentMark kind={k} />,
    };
  });
}

/**
 * The Agent row of New session (a `PickerRow`): the agent mark and the name of the chosen agent.
 * A tap opens the picker sheet with Shell and every agent kind.
 */
export function AgentPicker({
  value,
  onChange,
  installed,
  disabled,
}: {
  value: string;
  onChange: (kind: string) => void;
  installed: AgentsInstalled | undefined;
  disabled?: boolean;
}) {
  return <PickerRow title="Agent" Icon={Bot} disabled={disabled} picker={{ options: agentOptions(installed), value, onPick: onChange }} />;
}
