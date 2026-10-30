import type { ThreadItem } from "@zogssh/protocol";
import { memo } from "react";

import { AssistantMessage } from "./items/AssistantMessage";
import { SubagentCard } from "./items/SubagentCard";
import { SystemRow } from "./items/SystemRow";
import { ThinkingRow } from "./items/ThinkingRow";
import { ToolCard } from "./items/ToolCard";
import { UserBubble } from "./items/UserBubble";

/** One thread item. Memoized: an unchanged item object never re-renders. */
export const ThreadRow = memo(function ThreadRow({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "user":
      return <UserBubble text={item.text} images={item.images} />;
    case "assistant":
      return <AssistantMessage markdown={item.markdown} />;
    case "thinking":
      return <ThinkingRow text={item.text} />;
    case "tool":
      return <ToolCard name={item.name} inputSummary={item.input_summary} input={item.input} result={item.result} />;
    case "subagent":
      return (
        <SubagentCard
          description={item.description}
          status={item.status}
          resultSummary={item.result_summary}
          agentId={item.agent_id}
        />
      );
    case "system":
      return <SystemRow text={item.text} />;
    default:
      return null;
  }
});
