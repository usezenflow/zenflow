import { format, t } from "@/lib/i18n";

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [
    /^\w+ (\d{4}-\d{2}-\d{2}) holds (\d+)% of the busy time\.$/,
    (m) =>
      t("{day} holds {n}% of the busy time.", {
        day: format(new Date(`${m[1]}T00:00:00`), "EEE d/M"),
        n: m[2],
      }),
  ],
  [
    /^No lunch break on (\d+) day\(s\)\.$/,
    (m) => t("No lunch break on {n} day(s).", { n: m[1] }),
  ],
  [
    /^(\d+) task\(s\) have no time yet\.$/,
    (m) => t("{n} task(s) have no time yet.", { n: m[1] }),
  ],
];

/** The backend writes recap insights in English; map each known sentence to the app language. */
export function insightText(line: string): string {
  for (const [re, out] of RULES) {
    const m = re.exec(line);
    if (m) return out(m);
  }
  return line;
}
