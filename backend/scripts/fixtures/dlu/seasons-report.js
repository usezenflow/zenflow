// Per-phase request counts for the seasonal ingestion simulation (bench.sh SEASONS=1).
// Usage: node seasons-report.js <out-dir>
// Reads season-<mark>.json (the fake DLU's /_/stats at each mark, in order) and prints the
// requests between consecutive marks, grouped by what they were for.
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
const marks = fs
  .readFileSync(path.join(dir, "season-marks.txt"), "utf8")
  .trim()
  .split("\n");

const GROUPS = [
  ["discovery", /^(dkhp:history:|lms:enrolled:)/],
  ["timetable", /^portal:timetable:/],
  ["exam", /^portal:exam:/],
  ["marks", /^portal:marks:/],
  ["profile", /^portal:(info|studyprogram)/],
  ["lms calendar", /^lms:calendar:/],
  ["auth", /^(lms:login_|lms:my_sesskey|portal:authenticate|dkhp:authenticate)/],
];
const load = (m) => JSON.parse(fs.readFileSync(path.join(dir, `season-${m}.json`), "utf8")).byKey ?? {};

const rows = [];
for (let i = 1; i < marks.length; i++) {
  const a = load(marks[i - 1]);
  const b = load(marks[i]);
  const row = { interval: `${marks[i - 1]} -> ${marks[i]}` };
  for (const [name, re] of GROUPS) {
    row[name] = Object.entries(b)
      .filter(([k]) => re.test(k))
      .reduce((n, [k, v]) => n + v - (a[k] ?? 0), 0);
  }
  rows.push(row);
}
console.log(["interval", ...GROUPS.map(([n]) => n)].join(" | "));
for (const r of rows) console.log([r.interval, ...GROUPS.map(([n]) => r[n])].join(" | "));
fs.writeFileSync(path.join(dir, "seasons.json"), JSON.stringify(rows, null, 2));
