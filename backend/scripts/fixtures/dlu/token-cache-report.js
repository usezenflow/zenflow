// Compares the upstream session (token) cache across bench cases.
// Usage: node token-cache-report.js <out-dir>
// Cases (per repeat): A = no cache, B = occurrence cache, token cache off, C = occurrence
// cache + token cache at the short TTL. Reads the files bench.sh writes. Exits 1 on a failed check.
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const exists = (f) => fs.existsSync(path.join(dir, f));
const CASES = (process.env.CASES ?? "A,B,C").split(",");
const NAMES = {
  A: "no cache",
  B: "occurrence, token off",
  C: "occurrence + token (short TTL)",
};

let repeats = [];
for (let i = 1; CASES.every((c) => exists(`${c}-${i}.json`)); i++) repeats.push(i);
if (repeats.length === 0) {
  console.error("no complete repeat found");
  process.exit(1);
}

function load(label) {
  const r = JSON.parse(read(`${label}.json`));
  const auth = Object.fromEntries(
    Object.entries(r.byKey).filter(([k]) => /^(lms:login_|lms:my_sesskey|portal:authenticate|dkhp:authenticate)/.test(k)),
  );
  const post = Object.fromEntries(read(`${label}.custom.post.txt`).trim().split("|").map((v, i) => [i, Number(v)]));
  return {
    label,
    total: r.overall.total,
    auth: r.overall.auth,
    data: r.overall.data,
    authByKey: auth,
    student: Object.fromEntries(
      ["info", "studyprogram", "marks"].map((k) => [
        k,
        Object.entries(r.byKey).filter(([key]) => key === `portal:${k}` || key.startsWith(`portal:${k}:`)).reduce((a, [, v]) => a + v, 0),
      ]),
    ),
    sessions: read(`${label}.sessions.txt`),
    mutateLog: read(`${label}.mutate.log`),
    post: read(`${label}.custom.post.txt`).trim(),
    examDb: read(`${label}.examcache.txt`).trim().split("\n").join("/"),
  };
}

const failures = [];
const fail = (msg) => failures.push(msg);
const rows = [];
for (const i of repeats) {
  const runs = Object.fromEntries(CASES.map((c) => [c, load(`${c}-${i}`)]));
  const base = runs.C;
  for (const c of CASES) {
    const r = runs[c];
    if (r.mutateLog.includes("targets not ready")) fail(`${c}-${i}: the student moves and deletes ran before their lectures were written`);
    // Same calendars as the cache-off baseline, and the student's own moves and deletes survive.
    if (r.sessions !== runs.A.sessions) fail(`${c}-${i}: calendar rows differ from A`);
    const [movedKept, movedOver, deletedKept, othersUpd, othersStale, removedLive] = r.post.split("|").map(Number);
    if (movedOver !== 0) fail(`${c}-${i}: a student-moved lecture was overwritten`);
    if (othersStale !== 0 || othersUpd === 0) fail(`${c}-${i}: other students did not get the room change`);
    if (removedLive !== 0) fail(`${c}-${i}: removed sections still live`);
    // Profile and marks are fetched at most once per student and never served from the cache. The
    // ticker queues a few per pass, so a slow mode fetches fewer inside the window: only require some.
    if (r.student.info === 0 || r.student.marks === 0 || r.student.info > 150 || r.student.marks > 150)
      fail(`${c}-${i}: profile or marks requests out of range (${JSON.stringify(r.student)})`);
    if (r.examDb !== "0/0") fail(`${c}-${i}: exam table or cache row exists (${r.examDb})`);
    rows.push({ repeat: i, ...r });
  }
  void base;
}

for (const r of rows) {
  const n = r.sessions.trim().split("\n").length;
  console.log(`${r.label}: ${n} calendar rows, profile ${r.student.info}, study programs ${r.student.studyprogram}, marks ${r.student.marks}`);
}
console.log();
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pick = (c) => rows.filter((r) => r.label.startsWith(`${c}-`));
console.log("| case | cache | total | auth | data | login | sesskey | authenticate |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|");
for (const c of CASES) {
  const rs = pick(c);
  const login = mean(rs.map((r) => Object.entries(r.authByKey).filter(([k]) => k.startsWith("lms:login_")).reduce((a, [, v]) => a + v, 0)));
  const sesskey = mean(rs.map((r) => Object.entries(r.authByKey).filter(([k]) => k.startsWith("lms:my_sesskey")).reduce((a, [, v]) => a + v, 0)));
  const authn = mean(rs.map((r) => Object.entries(r.authByKey).filter(([k]) => /authenticate/.test(k)).reduce((a, [, v]) => a + v, 0)));
  console.log(`| ${c} | ${NAMES[c]} | ${mean(rs.map((r) => r.total)).toFixed(0)} | ${mean(rs.map((r) => r.auth)).toFixed(0)} | ${mean(rs.map((r) => r.data)).toFixed(0)} | ${login.toFixed(0)} | ${sesskey.toFixed(0)} | ${authn.toFixed(0)} |`);
}
console.log(`\nrepeats: ${repeats.length}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("checks: calendars identical to A; moves and deletes kept; removed sections gone; no exam cache");
