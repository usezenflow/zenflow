#!/usr/bin/env node
// Load test with live ingestion on the loadtest stack (loadtest/compose.ingestion.yml, `api` profile):
// k6 drives the HTTP API (weights in loadtest/staging/workload.js) while the in-process ingestion ticker
// syncs every connected student from the fake DLU at scaled periods (LMS 15 s, portal 3 min).
//
//   node loadtest/ingestion/orchestrate.js up      # build the API image, start the stack, wait for health
//   node loadtest/ingestion/orchestrate.js seed    # seed users via the API (+ cookies.json), take a DB snapshot
//   node loadtest/ingestion/orchestrate.js run     # restore the snapshot, run 10 min of sync.js + workload.js
//   node loadtest/ingestion/orchestrate.js down    # stop and remove containers
//
// Env: SEED_LIGHT/MEDIUM/HEAVY (300/150/50) CONCURRENT (125) THINK_S HOLD_S (120) RAMP_S (30) MAX_MULT (3)
//      SYNC_USERS (200) SYNC_RATE
// Results land in loadtest/ingestion/results/<timestamp>/ (git-ignored).
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const COMPOSE = path.join(ROOT, "loadtest/compose.ingestion.yml");
const RESULTS = path.join(__dirname, "results");
const COOKIES = path.join(RESULTS, "cookies.json");
const SNAPSHOT = path.join(RESULTS, "seed.dump");
const BASE = process.env.BASE || "http://localhost:5841/api/v1";
const MAIL = process.env.MAIL || "http://localhost:8741";
const FAKE = process.env.FAKE_DLU || "http://localhost:4141";
const PG = "zf-lt-ing-db";
const DB = "zenflow";
const SEED = { light: +(process.env.SEED_LIGHT || 300), medium: +(process.env.SEED_MEDIUM || 150), heavy: +(process.env.SEED_HEAVY || 50) };
const WATCHED = ["zf-lt-ing-api", "zf-lt-ing-db", "zf-lt-ing-bandit", "zf-lt-ing-fake-dlu", "zf-lt-ing-redis-queue"];

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  return r;
};
const compose = (...args) => sh("docker", ["compose", "-f", COMPOSE, "--profile", "api", ...args]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const k6Env = (extra = {}) => Object.entries({ BASE, MAIL, MAIL_KIND: "mailpit", ...extra }).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

async function waitApi() {
  for (let i = 0; i < 150; i++) {
    const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "3", `${BASE}/auth/me`], { encoding: "utf8" });
    if (/^[1-5]\d\d$/.test(r.stdout) && !["502", "503", "504"].includes(r.stdout)) return console.log("api up, /auth/me ->", r.stdout);
    await sleep(2000);
  }
  throw new Error("api did not come up");
}

async function up() {
  sh("docker", ["build", "-q", "-f", path.join(ROOT, "loadtest/Dockerfile.api"), "-t", "zf-lt-api:ing", ROOT]);
  compose("up", "-d", "--build");
  await waitApi();
}

// k6's --console-output is logfmt: the tabs in `COOKIE\t<email>\t<cookie>` are escaped as a literal backslash-t.
function parseCookies(log) {
  const out = {};
  for (const line of fs.readFileSync(log, "utf8").split("\n")) {
    const m = line.match(/COOKIE\\t([^\\]+)\\t([^"]+)/);
    if (m) out[m[1]] = m[2];
    if (line.includes("SEEDFAIL")) console.warn(line.trim().slice(0, 200));
  }
  return out;
}

function seed() {
  fs.mkdirSync(RESULTS, { recursive: true });
  const all = {};
  for (const [level, users] of Object.entries(SEED)) {
    const log = path.join(RESULTS, `seed-${level}.log`);
    console.log(`seeding ${users} ${level} users...`);
    sh("k6", ["run", "--quiet", "--console-output", log, ...k6Env({ LEVEL: level, USERS: users, PAR: process.env.SEED_PAR || 10 }), path.join(ROOT, "loadtest/scripts/seed.js")]);
    Object.assign(all, parseCookies(log));
  }
  fs.writeFileSync(COOKIES, JSON.stringify(all));
  const r = sh("docker", ["exec", PG, "pg_dump", "-U", "admin", "-d", DB, "-Fc"], { capture: true, encoding: "buffer", maxBuffer: 1 << 30 });
  fs.writeFileSync(SNAPSHOT, r.stdout);
  console.log(`${Object.keys(all).length} users seeded, snapshot ${(r.stdout.length / 1e6).toFixed(1)} MB`);
}

async function restore() {
  console.log("restoring seed snapshot (api stopped)...");
  compose("stop", "api");
  sh("docker", ["exec", PG, "psql", "-U", "admin", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`]);
  sh("docker", ["exec", PG, "psql", "-U", "admin", "-d", "postgres", "-c", `CREATE DATABASE "${DB}"`]);
  sh("docker", ["exec", "-i", PG, "pg_restore", "-U", "admin", "-d", DB, "--no-owner", "--exit-on-error"], { input: fs.readFileSync(SNAPSHOT), stdio: ["pipe", "inherit", "inherit"] });
  for (const c of ["session", "ratelimit", "queue"]) sh("docker", ["exec", `zf-lt-ing-redis-${c}`, "redis-cli", "FLUSHALL"], { capture: true });
  compose("up", "-d", "api");
  await waitApi();
}

const toMiB = (s) => { const m = s.match(/([\d.]+)\s*(B|KiB|MiB|GiB)/); return m ? +m[1] * { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]] : NaN; };
function sampleStats() {
  const rows = {};
  const timer = setInterval(() => {
    const r = spawnSync("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...WATCHED], { encoding: "utf8" });
    for (const line of (r.stdout || "").split("\n").filter(Boolean)) {
      try {
        const j = JSON.parse(line);
        (rows[j.Name] ||= []).push({ cpu: parseFloat(j.CPUPerc) / 100, mem: toMiB(j.MemUsage.split("/")[0]) });
      } catch { /* ignore a malformed sample */ }
    }
  }, 15000);
  return {
    stop: () => clearInterval(timer),
    summary: () => Object.fromEntries(Object.entries(rows).map(([n, xs]) => [n, {
      samples: xs.length,
      cpuCoresAvg: +(xs.reduce((a, x) => a + x.cpu, 0) / xs.length).toFixed(2),
      cpuCoresMax: +Math.max(...xs.map((x) => x.cpu)).toFixed(2),
      memMiBMax: Math.round(Math.max(...xs.map((x) => x.mem))),
    }])),
  };
}

async function run() {
  if (!fs.existsSync(COOKIES)) throw new Error("no cookies.json; run `seed` first");
  await restore();
  const out = path.join(RESULTS, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(out, { recursive: true });
  sh("curl", ["-s", "-X", "POST", `${FAKE}/_/reset`, "-o", "/dev/null"]);
  sh("docker", ["exec", PG, "psql", "-U", "admin", "-d", DB, "-qc", "SELECT pg_stat_statements_reset()"], { allowFail: true });
  const stats = sampleStats();
  // 10 min with the defaults: 120 s warm-up, 1x/2x/3x holds of 120 s, two 30 s ramps, 60 s ramp-down.
  const env = { COOKIES, PROFILE: "full", HOLD_S: process.env.HOLD_S || 120, RAMP_S: process.env.RAMP_S || 30, MAX_MULT: process.env.MAX_MULT || 3, CONCURRENT: process.env.CONCURRENT || 125 };
  const k6 = (name, script, extra) => new Promise((resolve) => {
    const p = spawn("k6", ["run", "--quiet", ...k6Env({ ...env, OUT: path.join(out, `${name}.json`), ...extra }), path.join(ROOT, "loadtest/staging", script)], { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", resolve);
  });
  const codes = await Promise.all([
    k6("sync", "sync.js", { SYNC_USERS: process.env.SYNC_USERS || 200, SYNC_RATE: process.env.SYNC_RATE || 0.2 }),
    k6("workload", "workload.js", {}),
  ]);
  stats.stop();
  fs.writeFileSync(path.join(out, "containers.json"), JSON.stringify(stats.summary(), null, 2));
  fs.writeFileSync(path.join(out, "fake-dlu-stats.json"), sh("curl", ["-s", `${FAKE}/_/stats`], { capture: true }).stdout);
  fs.writeFileSync(path.join(out, "api.log"), sh("docker", ["logs", "zf-lt-ing-api"], { capture: true, allowFail: true }).stdout || "");
  sh("docker", ["exec", PG, "psql", "-U", "admin", "-d", DB, "-c", "SELECT calls, round(total_exec_time::numeric) AS total_ms, round(mean_exec_time::numeric,2) AS mean_ms, rows, left(query,90) AS query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10"], { allowFail: true });
  console.log(`\nresults: ${out}\nk6 exit codes (sync, workload): ${codes.join(",")}  (99 = a threshold failed)`);
  process.exitCode = codes.every((c) => c === 0) ? 0 : 1;
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === "up") await up();
    else if (cmd === "seed") seed();
    else if (cmd === "run") await run();
    else if (cmd === "down") compose("down", "-v");
    else console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 13).join("\n"));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
