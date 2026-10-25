/** One VEVENT in the feed. Times are real instants; output is always UTC. */
export interface IcsEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
}

const LINE_LIMIT = 75;

/** RFC 5545 TEXT escaping. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** `20261030T170000Z`. */
export function utcStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Folds a content line at 75 octets, continuing with a leading space. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let size = 0;
  let limit = LINE_LIMIT;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, "utf8");
    if (size + bytes > limit) {
      out.push(current);
      current = "";
      size = 0;
      limit = LINE_LIMIT - 1;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** A whole calendar as an RFC 5545 document with CRLF endings. */
export function buildIcs(events: IcsEvent[], stamp: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zenflow//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Zenflow",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${utcStamp(stamp)}`,
      `DTSTART:${utcStamp(e.start)}`,
      `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
