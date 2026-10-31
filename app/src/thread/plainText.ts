import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";

/**
 * The plain text of a markdown reply: what a reader sees, without the markdown marks. Lists keep
 * their bullets and numbers, code keeps its text, links keep their label, table cells are split
 * by tabs. Copy uses it; "Copy as Markdown" copies the source instead.
 */


const md = MarkdownIt({ typographer: false, linkify: false });

function inline(children: Token[] | null): string {
  let out = "";
  for (const c of children ?? []) {
    if (c.type === "text" || c.type === "code_inline" || c.type === "html_inline") out += c.content;
    else if (c.type === "softbreak" || c.type === "hardbreak") out += "\n";
    else if (c.type === "image") out += c.content || c.attrGet("alt") || "";
  }
  return out;
}

export function plainText(markdown: string): string {
  const tokens = md.parse(markdown, {});
  /** One entry per open list: the next number of an ordered list, or null for bullets. */
  const lists: (number | null)[] = [];
  let out = "";
  /** Whether the last block was a list item or a table row: the next one follows on its own line. */
  let tight = false;
  let row: string[] | null = null;
  let prefix = "";

  const add = (text: string, isTight: boolean) => {
    if (out) out += tight && isTight ? "\n" : "\n\n";
    out += text;
    tight = isTight;
  };

  const push = (text: string) => {
    const indent = "  ".repeat(Math.max(0, lists.length - 1));
    const lines = text.replace(/\n+$/, "").split("\n");
    add(lines.map((l, i) => (i === 0 ? indent + prefix + l : indent + " ".repeat(prefix.length) + l)).join("\n"), lists.length > 0);
    prefix = "";
  };

  for (const t of tokens) {
    switch (t.type) {
      case "bullet_list_open":
        lists.push(null);
        break;
      case "ordered_list_open":
        lists.push(Number(t.attrGet("start") ?? 1));
        break;
      case "bullet_list_close":
      case "ordered_list_close":
        lists.pop();
        // A new list or a paragraph after a list starts after a blank line.
        if (lists.length === 0) tight = false;
        break;
      case "list_item_open": {
        const n = lists[lists.length - 1];
        prefix = n === null || n === undefined ? "• " : `${n}. `;
        if (typeof n === "number") lists[lists.length - 1] = n + 1;
        break;
      }
      case "tr_open":
        row = [];
        break;
      case "tr_close":
        if (row) add(row.join("\t"), true);
        row = null;
        break;
      case "table_close":
        tight = false;
        break;
      case "inline":
        if (row) row.push(inline(t.children));
        else push(inline(t.children));
        break;
      case "fence":
      case "code_block":
        push(t.content);
        break;
      case "hr":
        push("———");
        break;
    }
  }
  return out.trim();
}
