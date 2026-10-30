/** Words that end with a period but do not end a sentence. Lower case, without the period. */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "fig", "approx", "cf", "inc", "ltd",
]);

/** A short sentence joins the next one, so a clip is never a single word. */
const MIN_CHARS = 12;

/**
 * Splits speech text into sentences for one TTS call each. A sentence ends at `.`, `!` or `?`
 * (with trailing quotes or brackets) followed by a space, or at a newline. A period after a
 * known abbreviation, a single letter ("J. Doe") or inside a number or name ("v1.2", "main.rs")
 * does not end a sentence. Short pieces join the next piece.
 */
export function splitSentences(text: string): string[] {
  const pieces: string[] = [];
  for (const line of text.split(/\n+/)) {
    let start = 0;
    const end = /[.!?]+["')\]]*(?=\s)/g;
    for (let m = end.exec(line); m; m = end.exec(line)) {
      const stop = m.index + m[0].length;
      if (m[0][0] === "." && m[0].length === 1) {
        const word = /(\S+)$/.exec(line.slice(start, m.index))?.[1] ?? "";
        const bare = word.replace(/^["'(\[]+/, "").toLowerCase();
        if (ABBREVIATIONS.has(bare) || /^[a-z]$/i.test(bare)) continue;
      }
      pieces.push(line.slice(start, stop));
      start = stop;
    }
    pieces.push(line.slice(start));
  }
  const out: string[] = [];
  let carry = "";
  for (const raw of pieces) {
    const p = raw.trim();
    if (!p) continue;
    carry = carry ? `${carry} ${p}` : p;
    if (carry.length >= MIN_CHARS) {
      out.push(carry);
      carry = "";
    }
  }
  if (carry) {
    if (out.length) out[out.length - 1] += ` ${carry}`;
    else out.push(carry);
  }
  return out;
}
