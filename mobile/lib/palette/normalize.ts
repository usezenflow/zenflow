export type TokenKind = "NUM" | "WORD" | "SYM";

export interface Token {
  kind: TokenKind;
  /** Lowercase, diacritic-folded text. */
  text: string;
  /** Span in the original string, end exclusive. */
  start: number;
  end: number;
}

const URL_RE = /https?:\/\/\S+/gi;

/** Lowercase, diacritic-folded copy of `s` plus the original index of every folded char. */
export function fold(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch
      .normalize("NFKC")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/g, "d");
    // One map entry per UTF-16 unit, so an emoji (two units) keeps later offsets aligned.
    text += f;
    for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  return { text, map };
}

/** URLs found in `s`, as original spans. They never reach the tokenizer. */
export function urlSpans(s: string): [number, number][] {
  return [...s.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length]);
}

/** Splits glued forms ("2tiếng", "7h30", "t6") because digits and letters tokenize apart. */
export function tokenize(s: string): Token[] {
  const { text, map } = fold(s);
  const skip = urlSpans(s);
  const out: Token[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?|[a-z]+|\S/g)) {
    const start = map[m.index];
    const last = m.index + m[0].length - 1;
    const end = map[last] + 1;
    if (skip.some(([a, b]) => start >= a && start < b)) continue;
    const kind: TokenKind = /^\d/.test(m[0])
      ? "NUM"
      : /^[a-z]/.test(m[0])
        ? "WORD"
        : "SYM";
    out.push({ kind, text: m[0], start, end });
  }
  return out;
}

/** Damerau-Levenshtein distance of at most 1, which is all the vocab matcher needs. */
export function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return (
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** Exact match, or one typo on words of 4+ letters. */
export function is(word: string, vocab: readonly string[]): boolean {
  return vocab.some(
    (v) => v === word || (v.length >= 4 && word.length >= 4 && near(word, v)),
  );
}

/** Own-key lookup, so a typed word like "constructor" is never a vocab hit. */
export function own<T>(
  o: Record<string, T>,
  k: string | undefined,
): T | undefined {
  return k !== undefined && Object.hasOwn(o, k) ? o[k] : undefined;
}
