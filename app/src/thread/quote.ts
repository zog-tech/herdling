import { useEffect, useRef } from "react";
import { create } from "zustand";

/**
 * "Quote in reply" from a thread row: the row puts a request here, and the composer of the same
 * pane takes it. The composer and the thread do not share state otherwise.
 */

type Request = { key: string; text: string };

export const useQuoteRequest = create<{ req?: Request }>(() => ({}));

const keyOf = (hostId: string, paneId: string) => `${hostId}\u0000${paneId}`;

export function requestQuote(hostId: string, paneId: string, text: string): void {
  useQuoteRequest.setState({ req: { key: keyOf(hostId, paneId), text } });
}

/** The text as a markdown quote: `> ` before each line, then an empty line for the answer. */
export function quoteBlock(text: string): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  return `${lines.map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`;
}

/** The draft with the quote added at its end. Text already typed stays. */
export function withQuote(draft: string, text: string): string {
  const q = quoteBlock(text);
  return draft.trim() ? `${draft.replace(/\s+$/, "")}\n\n${q}` : q;
}

/** Calls `take` with each quote request for this pane, then clears the request. */
export function useQuoteInto(hostId: string, paneId: string, take: (text: string) => void): void {
  const key = keyOf(hostId, paneId);
  const req = useQuoteRequest((s) => (s.req?.key === key ? s.req : undefined));
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    if (!req) return;
    useQuoteRequest.setState({ req: undefined });
    takeRef.current(req.text);
  }, [req]);
}
