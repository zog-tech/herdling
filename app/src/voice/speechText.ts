/** Ends a line with a period when it has no end mark, so it does not run into the next line. */
const endLine = (line: string) => (/[.!?:;,]["')\]]*\s*$/.test(line) ? line : `${line.trimEnd()}.`);

/** Turns reply markdown into text that sounds right when read aloud. */
export function speechText(markdown: string): string {
  let t = markdown.replace(/\r\n?/g, "\n");
  // Fenced code (``` or ~~~), also when the fence never closes.
  t = t.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*\1[^\n]*(?=\n|(?![\s\S]))|(?![\s\S]))/gm, "\ncode block.\n");
  // Tables: a run of lines that start with "|".
  t = t.replace(/(?:^[ \t]*\|.*(?:\n|$))+/gm, "\na table.\n");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/[^\s)>\]]+/g, "a link");
  t = t.replace(/`+([^`\n]*)`+/g, "$1");
  // A heading or list item is its own sentence.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gm, (_, l: string) => endLine(l));
  t = t.replace(/^[ \t]*>[ \t]?/gm, "");
  t = t.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.*)$/gm, (_, l: string) => endLine(l));
  t = t.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1");
  t = t.replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, "$1");
  t = t.replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1");
  t = t.replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1");
  t = t.replace(/~~(.+?)~~/g, "$1");
  return t.replace(/\s+/g, " ").trim();
}
