import { randomInt } from "crypto";

/** No I, O, 0 or 1, so a code read off a screen is typed back right. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

/** shortcut: no retry on a duplicate, odds are 1 in 10^12 per live request; add one if volume grows. */
export function newUserCode(): string {
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** What the user types, trimmed of spaces and dashes; null when it cannot be a code. */
export function normalizeUserCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(code) ? code : null;
}

/** The code as shown, in two groups of four. */
export const showUserCode = (code: string): string =>
  `${code.slice(0, 4)} ${code.slice(4)}`;
