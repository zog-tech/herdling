/**
 * The prompt text of a share: the user's note first, then the link and the text. The paths of the
 * uploaded files go after it (`withPaths` and `pathLines` of the composer). Pure.
 */
import type { SharedContent } from "./content";

export type ShareBodyInput = {
  note: string;
  content: Pick<SharedContent, "url" | "text">;
  /** The title of the link from its preview or from the sending app. */
  title?: string;
  /** True when the text goes as a `.txt` file (a long text), so the prompt does not repeat it. */
  textInFile?: boolean;
};

/** The prompt text before the file paths. Empty when the share is only files and there is no note. */
export function shareBody({ note, content, title, textInFile }: ShareBodyInput): string {
  const blocks: string[] = [];
  const n = note.trim();
  if (n) blocks.push(n);
  const text = content.text?.trim();
  const url = content.url?.trim();
  // The link goes on its own line, unless the text already has it.
  if (url && !(text && !textInFile && text.includes(url))) {
    const t = title?.trim();
    blocks.push(t ? `Shared link: ${url}\nTitle: ${t}` : `Shared link: ${url}`);
  }
  if (text) blocks.push(textInFile ? "Shared text: in the .txt file below." : `Shared text:\n${text}`);
  return blocks.join("\n\n");
}
