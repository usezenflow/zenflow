#!/usr/bin/env bash
# Benchmark: baseline (occurrence cache + fan-out off, "A") vs cache + fan-out
# ("B"). The ticker fires every minute, as in production, and each run is 5
# ticks. Every sync period is 2 minutes, so each tick claims a batch of 75 of the
# 150 students and two ticks make one rolling window in which every student is
# synced once.
#   ticks 1-2  new: first ingestion, every session is new
#   after 2    some students move / delete lectures in Zenflow, then upstream:
#              8 sections change room, 8 others are removed
#   ticks 3-4  the batches pick up the changes
#   tick 5     spare, for batches whose due time slipped a tick
# Each run also deletes the StudentProfile rows, so every student pulls profile, study
# programs and marks once inside the measured window (the ticker's missing-profile pass).
# Each case is repeated REPEATS times, interleaved.
#
# DESTRUCTIVE to the DEV database: `zenflow` is dropped and recreated for every
# run, Redis is flushed. Dev docker stack (backend/compose.dev.yml) must already
# be up. Everything points at the local fake DLU server; never run this against
# real hosts.
#
# Usage: backend/scripts/fixtures/dlu/bench.sh [TICKS=5] [LATENCY_MS=4]
# Env:   REPEATS=3 JITTER_MS=4 SETTLE_SEC=70 CASES=A,C,B OUT=/tmp/dlu-bench
# Output: $OUT with per-run JSON, logs, session dumps; comparison on stdout.
set -euo pipefail
# Benchmark database. .env.dev names zenflow-prod; this script must never write there.
export POSTGRES_DB=zenflow

TICKS="${1:-5}"
LATENCY_MS="${2:-4}"
JITTER_MS="${JITTER_MS:-4}"
REPEATS="${REPEATS:-3}"
# Long enough for one more tick to fire after the measured ones.
SETTLE_SEC="${SETTLE_SEC:-70}"
OUT="${OUT:-/tmp/dlu-bench}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$(cd "$HERE/../../.." && pwd)"
API="http://localhost:8000/api/v1"
FAKE="http://localhost:4100"
# INFRA=dev: the backend/compose.dev.yml containers (default). INFRA=loadtest: the
# loadtest/compose.ingestion.yml stack (docker compose -f loadtest/compose.ingestion.yml up -d).
INFRA="${INFRA:-dev}"
case "$INFRA" in
  dev)
    DB_CT=zenflow-db; REDIS_SESSION_CT=zenflow-redis-session; REDIS_RATELIMIT_CT=zenflow-redis-ratelimit; REDIS_QUEUE_CT=zenflow-redis-queue
    MAIL_URL=http://localhost:8025 ;;
  loadtest)
    DB_CT=zf-lt-ing-db; REDIS_SESSION_CT=zf-lt-ing-redis-session; REDIS_RATELIMIT_CT=zf-lt-ing-redis-ratelimit; REDIS_QUEUE_CT=zf-lt-ing-redis-queue
    MAIL_URL=http://localhost:8741
    export DB_PORT=5741 SESSION_REDIS_PORT=6761 RATE_LIMIT_REDIS_PORT=6762 QUEUE_REDIS_PORT=6763 \
      REDIS_KILLSWITCH_PORT=6764 REDIS_PUBSUB_PORT=6765 MAIL_PORT=1741 BANDIT_SERVICE_URL=http://localhost:8841 ;;
  *) echo "unknown INFRA $INFRA" >&2; exit 2 ;;
esac
export MAIL_URL
DAY_MS=86400000
# One rolling window = 2 one-minute ticks, 75 students per tick.
DATA_PERIOD_MS=120000
# PERIODS=scaled: production periods scaled 60x (LMS calendar 15 min -> 15 s, portal 3 h -> 3 min)
# and token TTLs to match (portal 100 min -> 100 s, LMS 50 min -> 50 s). Default: every kind 2 min.
LMS_PERIOD_MS=$DATA_PERIOD_MS; PORTAL_PERIOD_MS=$DATA_PERIOD_MS
if [ "${PERIODS:-}" = scaled ]; then
  LMS_PERIOD_MS=15000; PORTAL_PERIOD_MS="${PORTAL_PERIOD_MS:-180000}"
  SHORT_PORTAL_TTL_S="${SHORT_PORTAL_TTL_S:-100}"; SHORT_LMS_TTL_S="${SHORT_LMS_TTL_S:-50}"
fi
# Production default is 7 days. Here it is shorter than the 2-minute period, so a
# read made in one window has expired by the next and that window's first student
# per section refetches live, while the rest of the window still reuses it.
CACHE_TTL_MS=90000
# Token-cache TTLs for case D, in seconds: the production defaults (portal/DKHP 100 min,
# LMS 50 min) on the same 30x time scale as the 2-minute period (production: 1 h).
SHORT_PORTAL_TTL_S="${SHORT_PORTAL_TTL_S:-200}"
SHORT_LMS_TTL_S="${SHORT_LMS_TTL_S:-100}"
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$BACKEND"

PIDS=()
stop_procs() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  PIDS=()
  sleep 3
}
cleanup() {
  stop_procs
  [ -f "$OUT/portal-timetable.orig.json" ] && cp "$OUT/portal-timetable.orig.json" "$HERE/portal-timetable.json"
  psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed0 WITH (FORCE)' >/dev/null 2>&1 || true
  psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed WITH (FORCE)' >/dev/null 2>&1 || true
}
trap cleanup EXIT
cp "$HERE/portal-timetable.json" "$OUT/portal-timetable.orig.json"

psql_admin() { docker exec -i "$DB_CT" psql -v ON_ERROR_STOP=1 -U admin -d postgres -At "$@"; }
psql_() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$DB_CT" psql -v ON_ERROR_STOP=1 -U admin -d zenflow -At "$@"; }
flush_redis() {
  docker exec "$REDIS_SESSION_CT" redis-cli FLUSHALL >/dev/null
  docker exec "$REDIS_RATELIMIT_CT" redis-cli FLUSHALL >/dev/null
  # Jobs left by an earlier run would otherwise be worked off, in this run's time.
  docker exec "$REDIS_QUEUE_CT" redis-cli FLUSHALL >/dev/null
}
restore_db() { # restore_db <template>
  psql_admin -c 'DROP DATABASE IF EXISTS zenflow WITH (FORCE)' >/dev/null
  psql_admin -c "CREATE DATABASE zenflow TEMPLATE $1" >/dev/null
}
start_fake() { # start_fake <latency> <jitter>
  cp "$OUT/portal-timetable.orig.json" "$HERE/portal-timetable.json"
  FAKE_DLU_LATENCY_MS="$1" FAKE_DLU_JITTER_MS="$2" npx ts-node scripts/fake-dlu-server.ts >>"$OUT/fake.log" 2>&1 &
  PIDS+=($!)
}
start_backend() { # start_backend <log> VAR=value...   (overrides first: dotenv never overwrites)
  local log="$1"; shift
  env INGESTION_REQUEST_DELAY_MS=0 INGESTION_TICK_MAX_BATCH=1000 \
    LMS_URL="$FAKE" PORTAL_API_URL="$FAKE" DKHP_API_URL="$FAKE" \
    PORT=8000 OTP_REQUEST_IP_LIMIT=100000 OTP_REQUEST_EMAIL_LIMIT=100000 OTP_VERIFY_IP_LIMIT=100000 OTP_VERIFY_EMAIL_LIMIT=100000 OTP_REQUEST_IP_HOURLY_LIMIT=100000 PORTAL_API_KEY=bench DKHP_API_KEY=bench "$@" \
    npx dotenv -e .env.dev -- env NODE_EXTRA_CA_CERTS=certs/lms-ca.pem node dist/main >"$log" 2>&1 &
  PIDS+=($!)
}
wait_up() {
  for _ in $(seq 60); do curl -s -o /dev/null "$FAKE/_/stats" && curl -s -o /dev/null "$API/../" && return 0; sleep 2; done
  echo "stack did not come up" >&2; return 1
}
# wait_for_count <regex on byKey> <min> <timeout s>: poll the fake's counters.
wait_for_count() {
  for _ in $(seq "$3"); do
    n=$(curl -s "$FAKE/_/stats" | node -e '
      const re = new RegExp(process.argv[1]); let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const by = JSON.parse(s || "{}").byKey ?? {}; console.log(Object.entries(by).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0)); })' "$1")
    [ "${n:-0}" -ge "$2" ] && return 0
    sleep 1
  done
  echo "timed out waiting for $1 >= $2 (got ${n:-0})" >&2
  diagnose
  return 1
}
# Printed when a gate times out: what the ingestion pipeline recorded, and the tail of the backend log.
diagnose() {
  echo "--- diagnostics ---" >&2
  psql_ -c 'SELECT kind, count(*), min("nextDueAt") FROM "IngestionSchedule" GROUP BY kind' >&2 || true
  psql_ -c 'SELECT status, count(*) FROM "PortalAPIJob" GROUP BY status' >&2 || true
  psql_ -c 'SELECT * FROM "PortalAPIJob" ORDER BY 1 DESC LIMIT 3' >&2 || true
  curl -s "$FAKE/_/stats" >&2 || true
  echo >&2
  local log
  log=$(ls -t "$OUT"/*.backend.log 2>/dev/null | head -1)
  [ -n "$log" ] && grep -iv "PushService\|RouterExplorer\|InstanceLoader" "$log" | tail -n 25 | cut -c1-240 >&2
  echo "--- end diagnostics ---" >&2
}
NUM_STUDENTS=$(node -e 'console.log(require(process.argv[1]).length)' "$HERE/students.json")

# ---------------------------------------------------------------- one-time setup
echo "=== setup: seed $NUM_STUDENTS students with ingestion off ==="
psql_admin -c 'DROP DATABASE IF EXISTS zenflow WITH (FORCE)' >/dev/null
psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed0 WITH (FORCE)' >/dev/null
psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed WITH (FORCE)' >/dev/null
psql_admin -c 'CREATE DATABASE zenflow' >/dev/null
flush_redis
curl -s -X DELETE "$MAIL_URL/api/v1/messages" >/dev/null || true
echo "migrating"
npx dotenv -e .env.dev -- node scripts/with-database-url.cjs npx prisma migrate deploy >"$OUT/setup.migrate.log" 2>&1
start_fake 0 0
start_backend "$OUT/setup.seed.backend.log" INGESTION_ENABLED=false
wait_up; sleep 5
ZENFLOW_API="$API" node "$HERE/seed-and-sync.js" >"$OUT/setup.seed.log" 2>&1
tail -n 4 "$OUT/setup.seed.log" | head -n 2
stop_procs
psql_admin -c 'CREATE DATABASE zenflow_seed0 TEMPLATE zenflow' >/dev/null

# ---------------------------------------------------------------- seasonal simulation
# SEASONS=1 replaces the cache cases: the seeded students run through four calendar phases on
# a compressed clock (about a minute in all), and the requests of each phase are counted by
# kind. Real periods scale to the 5 s tick: 1 h -> 5 s, 3 h -> 15 s, 15 min -> 5 s, and the
# start-of-week timetable -> 30 s. The exam window and the one-week wait before marks are
# set by INGESTION_EXAM_WINDOW / INGESTION_MARKS_AFTER_EXAMS_MS instead of the real date.
if [ "${SEASONS:-0}" = 1 ]; then
  echo "=== seasons: semester start, exam season (staged), marks ==="
  restore_db zenflow_seed0; flush_redis
  psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now()" >/dev/null
  psql_ -c 'DELETE FROM "StudentProfile"' >/dev/null
  # Workers take one job at a time, so a 20 s phase only fits a few dozen students.
  SEASON_STUDENTS="${SEASON_STUDENTS:-40}"
  psql_ -c "DELETE FROM \"User\" WHERE id NOT IN (SELECT id FROM \"User\" ORDER BY email LIMIT $SEASON_STUDENTS)" >/dev/null
  start_fake 0 0
  for _ in $(seq 60); do curl -s -o /dev/null "$FAKE/_/stats" && break; sleep 1; done
  : >"$OUT/season-marks.txt"
  mark() {
    curl -s "$FAKE/_/stats" >"$OUT/season-$1.json"
    psql_ -c "SELECT now()" >"$OUT/season-$1.at"
    echo "$1" >>"$OUT/season-marks.txt"
  }
  season_backend() { # season_backend <phase> VAR=value...
    local phase="$1"; shift
    start_backend "$OUT/season-$phase.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED=true \
      INGESTION_PORTAL_DISCOVERY_PERIOD_MS=60000 INGESTION_TIMETABLE_PERIOD_MS=15000 \
      INGESTION_STUDENT_JOBS_PER_TICK=200 INGESTION_EXAM_PERIOD_MS=5000 INGESTION_LMS_CALENDAR_PERIOD_MS=5000 \
      INGESTION_MARKS_PERIOD_MS=5000 INGESTION_TIMETABLE_WEEKLY_MS=30000 "$@"
    BACKEND_PID=${PIDS[$((${#PIDS[@]} - 1))]}
    wait_up
  }
  season_stop() { kill "$BACKEND_PID" 2>/dev/null || true; sleep 3; }
  WEEK_MS=604800000

  # Exams are published for half of each student's sections and already ended 3 days ago.
  curl -s -X POST "$FAKE/_/exams" -d '{"publish":0.5,"pastDays":3}' >/dev/null
  mark start

  echo "phase 0: semester start (exam window closed): discovery, timetable, profile and first marks, until settled"
  season_backend p1 INGESTION_EXAM_WINDOW=closed INGESTION_MARKS_AFTER_EXAMS_MS=$WEEK_MS
  for _ in $(seq 90); do
    left=$(psql_ -c "SELECT
        $SEASON_STUDENTS - (SELECT count(*) FROM \"StudentProfile\" WHERE \"marksFetchedAt\" IS NOT NULL)
      + $SEASON_STUDENTS - (SELECT count(*) FROM \"IngestionSchedule\" WHERE kind = 'PORTAL_DISCOVERY' AND \"lastSuccessTerm\" IS NOT NULL)
      + $SEASON_STUDENTS - (SELECT count(*) FROM \"IngestionSchedule\" WHERE kind = 'LMS_DISCOVERY' AND \"lastSuccessAt\" IS NOT NULL)
      + $SEASON_STUDENTS - (SELECT count(*) FROM \"IngestionSchedule\" WHERE kind = 'PORTAL_TIMETABLE' AND \"lastSuccessAt\" IS NOT NULL)")
    [ "$left" = 0 ] && break
    sleep 2
  done
  [ "$left" = 0 ] || echo "warm-up did not settle (students still missing a step: $left)"
  mark p0-settled

  echo "phase 1: steady state: timetable at its weekly cadence, discovery and profiles parked"
  sleep 35; mark p1-end; season_stop

  echo "phase 2: exam season: half the exams published, then all of them"
  season_backend p2 INGESTION_EXAM_WINDOW=open INGESTION_MARKS_AFTER_EXAMS_MS=$WEEK_MS
  sleep 8; mark p2-half-published
  curl -s -X POST "$FAKE/_/exams" -d '{"publish":1,"pastDays":3}' >/dev/null
  sleep 12; mark p2-end; season_stop

  echo "phase 3: marks due (first exam ended more than the wait ago); exams stay parked"
  season_backend p3 INGESTION_EXAM_WINDOW=open INGESTION_MARKS_AFTER_EXAMS_MS=172800000
  sleep 15; mark p3-end; season_stop

  node "$HERE/seasons-report.js" "$OUT"
  # Runs the ticker started per interval, whether or not they cost an upstream request
  # (a timetable pass served from the occurrence cache makes none).
  echo
  echo "scheduled runs (total / served from cache):"
  prev=""
  for m in $(cat "$OUT/season-marks.txt"); do
    if [ -n "$prev" ]; then
      a=$(cat "$OUT/season-$prev.at"); b=$(cat "$OUT/season-$m.at")
      echo "$prev -> $m: $(psql_ -F ' ' -c "SELECT kind, count(*) || '/' || count(*) FILTER (WHERE \"servedFromCache\") FROM \"SyncRun\" WHERE \"claimedAt\" >= '$a' AND \"claimedAt\" < '$b' GROUP BY kind ORDER BY kind" | tr '\n' ',' )"
    fi
    prev=$m
  done
  stop_procs
  exit 0
fi

echo "=== setup: gate check (all kinds due at once, no discovery done yet) ==="
restore_db zenflow_seed0; flush_redis
# The snapshot's schedule rows carry the setup phase's due times; the gate needs every kind due now.
psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now()" >/dev/null
start_fake 0 0
start_backend "$OUT/setup.gate.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED=true \
  INGESTION_PORTAL_DISCOVERY_PERIOD_MS=60000 INGESTION_LMS_DISCOVERY_PERIOD_MS=60000 \
  INGESTION_TIMETABLE_PERIOD_MS=60000 INGESTION_EXAM_PERIOD_MS=60000 INGESTION_LMS_CALENDAR_PERIOD_MS=60000
wait_up
wait_for_count '^dkhp:history:' "$NUM_STUDENTS" 150
sleep 20
curl -s "$FAKE/_/log" >"$OUT/setup.gate.log.json"
stop_procs

echo "=== setup: discovery warm-up (one-time cost, data kinds held back) ==="
restore_db zenflow_seed0; flush_redis
psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() + interval '1 day' WHERE kind IN ('PORTAL_TIMETABLE','PORTAL_EXAM','LMS_CALENDAR')" >/dev/null
psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() WHERE kind IN ('PORTAL_DISCOVERY','LMS_DISCOVERY')" >/dev/null
start_fake 0 0
start_backend "$OUT/setup.warm.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED=false \
  INGESTION_PORTAL_DISCOVERY_PERIOD_MS=60000 INGESTION_LMS_DISCOVERY_PERIOD_MS=60000 \
  INGESTION_TIMETABLE_PERIOD_MS=$DAY_MS INGESTION_EXAM_PERIOD_MS=$DAY_MS INGESTION_LMS_CALENDAR_PERIOD_MS=$DAY_MS
wait_up
wait_for_count '^dkhp:history:' "$NUM_STUDENTS" 150
wait_for_count '^lms:enrolled:' "$NUM_STUDENTS" 150
sleep 5
curl -s "$FAKE/_/stats" >"$OUT/setup.warm.stats.json"
stop_procs
psql_admin -c 'CREATE DATABASE zenflow_seed TEMPLATE zenflow' >/dev/null

# ------------------------------------------------------------------------ runs
run() { # run <label> <cache true|false> [VAR=value...]
  local label="$1" cache="$2"
  shift 2
  echo "=== run $label (cache=$cache) ==="
  restore_db zenflow_seed; flush_redis
  # Discovery is done (snapshot) and next due a day out, as in production; the
  # three data kinds are due now.
  psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() WHERE kind IN ('PORTAL_TIMETABLE','PORTAL_EXAM','LMS_CALENDAR');
            UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() + interval '1 day' WHERE kind IN ('PORTAL_DISCOVERY','LMS_DISCOVERY');
            DELETE FROM \"StudentProfile\"" >/dev/null
  start_fake "$LATENCY_MS" "$JITTER_MS"
  start_backend "$OUT/$label.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED="$cache" "$@" \
    INGESTION_PORTAL_DISCOVERY_PERIOD_MS=$DAY_MS INGESTION_LMS_DISCOVERY_PERIOD_MS=$DAY_MS \
    INGESTION_CACHE_TTL_MS=$CACHE_TTL_MS \
    INGESTION_TIMETABLE_PERIOD_MS=$PORTAL_PERIOD_MS INGESTION_EXAM_PERIOD_MS=$PORTAL_PERIOD_MS INGESTION_LMS_CALENDAR_PERIOD_MS=$LMS_PERIOD_MS \
    INGESTION_TIMETABLE_WEEKLY_MS=$PORTAL_PERIOD_MS
  wait_up; sleep 5

  rm -f "$OUT/$label.started"
  UPD_IDS=$(node "$HERE/mutate.js" ids update); REM_IDS=$(node "$HERE/mutate.js" ids remove)
  (
    while [ ! -f "$OUT/$label.started" ]; do sleep 0.2; done
    # Deterministic targets, independent of how fast a mode syncs: in each changed section the
    # first enrolled student (by email) moves their lectures an hour later and the second deletes
    # theirs. The mutation waits until both students' lectures for the section have been written
    # and stopped changing; window 2 starts at +122 s, so the wait is capped before it.
    TGT="enr AS (SELECT e.\"scheduleStudyUnitId\" AS sec, e.\"userId\",
          row_number() OVER (PARTITION BY e.\"scheduleStudyUnitId\" ORDER BY u.email) AS rn
        FROM \"PortalSectionEnrollment\" e JOIN \"User\" u ON u.id = e.\"userId\"
        WHERE e.\"droppedAt\" IS NULL AND e.\"scheduleStudyUnitId\" ~ '^($UPD_IDS|$REM_IDS)\$')
      , tgt AS (SELECT * FROM enr WHERE rn IN (1, 2))"
    NEED=$(psql_ -c "WITH $TGT SELECT count(*) FROM tgt")
    MUTATE_CAP_S=$((PORTAL_PERIOD_MS / 1000 - 4))
    prev=-1; stable=0; waited=0; ready=0
    while [ "$waited" -lt "$MUTATE_CAP_S" ]; do
      sleep 2; waited=$((waited + 2))
      cur=$(psql_ -c "WITH $TGT SELECT count(DISTINCT (t.sec, t.\"userId\")) || ',' || count(*)
        FROM tgt t JOIN \"Session\" s ON s.\"userId\" = t.\"userId\" AND s.source = 'PORTAL'
          AND position(t.sec in s.\"externalKey\") > 0")
      if [ "$cur" = "$prev" ] && [ "${cur%%,*}" -ge "$NEED" ]; then stable=$((stable + 1)); else stable=0; fi
      prev=$cur
      if [ "$stable" -ge 3 ]; then ready=1; break; fi
    done
    [ "$ready" = 1 ] || echo "targets not ready after ${waited}s (pairs,rows: $cur, need pairs: $NEED)"
    echo "mutating after ${waited}s (pairs,rows: $cur, need pairs: $NEED)"
    psql_ -c "WITH $TGT
      , r AS (SELECT s.id, (position(t.sec in '|$UPD_IDS|') > 0) AS upd, t.rn
        FROM tgt t JOIN \"Session\" s ON s.\"userId\" = t.\"userId\" AND s.source = 'PORTAL' AND s.deleted = false
          AND position(t.sec in s.\"externalKey\") > 0)
      , mv AS (UPDATE \"Session\" s SET \"lastMovedAt\" = now(), \"scheduledStartTime\" = s.\"scheduledStartTime\" + interval '1 hour'
               FROM r WHERE r.id = s.id AND r.rn = 1 RETURNING r.upd)
      , del AS (UPDATE \"Session\" s SET deleted = true FROM r WHERE r.id = s.id AND r.rn = 2 RETURNING r.upd)
      SELECT 'moved_update', count(*) FILTER (WHERE upd) FROM mv UNION ALL SELECT 'moved_remove', count(*) FILTER (WHERE NOT upd) FROM mv
      UNION ALL SELECT 'deleted_update', count(*) FILTER (WHERE upd) FROM del UNION ALL SELECT 'deleted_remove', count(*) FILTER (WHERE NOT upd) FROM del" \
      -F '|' >"$OUT/$label.custom.pre.txt"
    node "$HERE/mutate.js" update; node "$HERE/mutate.js" remove
    curl -s -X POST "$FAKE/_/reload-fixtures" >/dev/null
  ) >"$OUT/$label.mutate.log" 2>&1 &
  MUTATOR=$!
  node "$HERE/measure.js" --ticks "$TICKS" --label "$label" --json "$OUT/$label.json" \
    --started-file "$OUT/$label.started" | tee "$OUT/$label.measure.log"
  wait "$MUTATOR"

  # Let in-flight passes drain so a slow baseline is compared on converged data.
  sleep "$SETTLE_SEC"
  curl -s "$FAKE/_/log" >"$OUT/$label.log.json"
  # Normalised calendar blocks: no ids or timestamps, sorted.
  psql_ -F '|' -c "SELECT u.email, s.\"externalKey\", s.source, s.type, s.title, coalesce(s.location,''),
      s.\"scheduledStartTime\", s.\"durationMinutes\", s.deleted
    FROM \"Session\" s JOIN \"User\" u ON u.id = s.\"userId\"
    WHERE s.source IN ('LMS','PORTAL') ORDER BY 1,2,3" >"$OUT/$label.sessions.txt"
  # What became of the student's own moves and deletes, and of everyone else.
  # Removed sections are checked from now on: a walk only reconciles upcoming sessions.
  psql_ -F '|' -c "SELECT
      count(*) FILTER (WHERE upd AND moved AND NOT deleted AND location NOT LIKE 'CHG-%') AS moved_kept,
      count(*) FILTER (WHERE upd AND moved AND location LIKE 'CHG-%') AS moved_overwritten,
      count(*) FILTER (WHERE upd AND deleted) AS deleted_kept,
      count(*) FILTER (WHERE upd AND NOT moved AND NOT deleted AND location LIKE 'CHG-%') AS others_updated,
      count(*) FILTER (WHERE upd AND NOT moved AND NOT deleted AND location NOT LIKE 'CHG-%') AS others_stale,
      count(*) FILTER (WHERE NOT upd AND NOT deleted AND start > now()) AS removed_still_live
    FROM (SELECT s.deleted, s.location, s.\"scheduledStartTime\" AS start, s.\"lastMovedAt\" IS NOT NULL AS moved, s.\"externalKey\" ~ '($UPD_IDS)' AS upd
          FROM \"Session\" s WHERE s.source = 'PORTAL' AND s.\"externalKey\" ~ '($UPD_IDS|$REM_IDS)') x" >"$OUT/$label.custom.post.txt"
  # Exams must never touch the cache: no exam table remains, and no cache row
  # carries an exam key.
  psql_ -c "SELECT count(*) FROM information_schema.tables WHERE table_name ILIKE '%exam%'" >"$OUT/$label.examcache.txt"
  psql_ -c "SELECT count(*) FROM \"LmsCourseOccurrence\" WHERE \"externalKey\" LIKE 'portal:exam%'" >>"$OUT/$label.examcache.txt"
  stop_procs
  cp "$OUT/portal-timetable.orig.json" "$HERE/portal-timetable.json"
}

# Cases: A no cache at all, B occurrence cache without the upstream session cache,
# C occurrence cache with the session and token cache, its TTLs scaled 30x down like the
# sync period so tokens expire inside the run.
TOKEN_OFF="UPSTREAM_SESSION_TTL_PORTAL_S=0 UPSTREAM_SESSION_TTL_LMS_S=0"
TOKEN_SHORT="UPSTREAM_SESSION_TTL_PORTAL_S=$SHORT_PORTAL_TTL_S UPSTREAM_SESSION_TTL_LMS_S=$SHORT_LMS_TTL_S"
# CASES picks and orders the cases (A is the calendar reference, so keep it first).
CASES="${CASES:-A,B,C}"
export CASES
for rep in $(seq "$REPEATS"); do
  for c in ${CASES//,/ }; do
    case "$c" in
      A) run "A-$rep" false $TOKEN_OFF ;;
      B) run "B-$rep" true $TOKEN_OFF ;;
      C) run "C-$rep" true $TOKEN_SHORT ;;
      *) echo "unknown case $c" >&2; exit 2 ;;
    esac
  done
done

node "$HERE/token-cache-report.js" "$OUT"
