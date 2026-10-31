import type { ThreadItem } from "@herdling/protocol";
import { memo, useContext } from "react";

import { ThreadPaneContext } from "./LiveToolContext";
import { AssistantMessage } from "./items/AssistantMessage";
import { ReplyPlayButton } from "./items/ReplyPlayButton";
import { SubagentCard } from "./items/SubagentCard";
import { SystemRow } from "./items/SystemRow";
import { ThinkingRow } from "./items/ThinkingRow";
import { ToolCard } from "./items/ToolCard";
import { UserBubble } from "./items/UserBubble";

/**
 * One thread item. Memoized: an unchanged item object never re-renders. It reads only the stable
 * pane context, so a new running tool does not re-render every row.
 */
export const ThreadRow = memo(function ThreadRow({ item }: { item: ThreadItem }) {
  const live = useContext(ThreadPaneContext);
  switch (item.kind) {
    case "user":
      return <UserBubble text={item.text} images={item.images} />;
    case "assistant":
      return (
        <>
          <AssistantMessage markdown={item.markdown} />
          {live ? <ReplyPlayButton hostId={live.hostId} id={item.id} markdown={item.markdown} /> : null}
        </>
      );
    case "thinking":
      return <ThinkingRow text={item.text} />;
    case "tool":
      return (
        <ToolCard id={item.id} ts={item.ts} name={item.name} inputSummary={item.input_summary} input={item.input} result={item.result} />
      );
    case "subagent":
      return (
        <SubagentCard
          description={item.description}
          status={item.status}
          resultSummary={item.result_summary}
          agentId={item.agent_id}
          startedAt={item.started_at}
          finishedAt={item.finished_at}
          activity={item.activity}
          toolCount={item.tool_count}
        />
      );
    case "system":
      return <SystemRow text={item.text} />;
    default:
      return null;
  }
});
