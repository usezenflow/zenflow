import { buildIcs, escapeText, foldLine, utcStamp } from "./ics";

describe("ics", () => {
  it("escapes text values", () => {
    expect(escapeText("Essay, draft; final\\v2\nlast")).toBe(
      "Essay\\, draft\; final\\\\v2\\nlast",
    );
  });

  it("writes UTC stamps without separators", () => {
    expect(utcStamp(new Date("2026-10-30T17:00:00.000Z"))).toBe(
      "20261030T170000Z",
    );
  });

  it("folds lines at 75 octets and keeps multi-byte characters whole", () => {
    const long = "é".repeat(60);
    const folded = foldLine(`SUMMARY:${long}`);
    for (const line of folded.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(folded.split("\r\n ").join("")).toBe(`SUMMARY:${long}`);
  });

  it("builds a calendar with one VEVENT per event and CRLF endings", () => {
    const ics = buildIcs(
      [
        {
          uid: "s1@zenflow",
          summary: "Essay",
          start: new Date("2026-10-30T17:00:00.000Z"),
          end: new Date("2026-10-30T18:00:00.000Z"),
        },
      ],
      new Date("2026-10-23T00:00:00.000Z"),
    );

    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n")).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:s1@zenflow",
        "DTSTAMP:20261023T000000Z",
        "DTSTART:20261030T170000Z",
        "DTEND:20261030T180000Z",
        "SUMMARY:Essay",
        "END:VEVENT",
        "END:VCALENDAR",
      ]),
    );
  });
});
