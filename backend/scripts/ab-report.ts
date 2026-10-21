/**
 * Read-only A/B report, HEURISTIC vs LINUCB (docs/scheduler/ab-testing.md §6).
 * Per primary policy: proposals, the offer funnel (offered, shown, tapped,
 * started) and which side the user picked, plus the settled outcome of each
 * session. Also per week, per observation bucket, and the activity-alignment
 * proxy against a 12-hour shifted baseline. PYTHON placements only.
 *
 *   pnpm --filter backend ab:report [--since 2026-10-01] [--csv <file>]
 *
 * Times are compared in UTC; the alignment is a proxy for fit to routine, not a
 * learning outcome (ADR-0025).
 */
import { writeFileSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

function sinceArg(): Date {
  const v = arg("--since");
  return v ? new Date(v) : new Date(0);
}

type Row = Record<string, string | number | null>;

/** Rows of several tables as one CSV, each tagged with its table name. */
function toCsv(tables: Record<string, Row[]>): string {
  const lines: Row[] = Object.entries(tables).flatMap(([table, rows]) =>
    rows.map((r) => ({ table, ...r })),
  );
  const keys = [...new Set(lines.flatMap((r) => Object.keys(r)))];
  const cell = (v: string | number | null | undefined) =>
    v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`;
  return [
    keys.join(","),
    ...lines.map((r) => keys.map((k) => cell(r[k])).join(",")),
  ].join("\n");
}

async function main(): Promise<void> {
  const since = sinceArg();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const tables: Record<string, Row[]> = {};
  try {
    const prisma = app.get(PrismaService);

    tables.proposals = (await prisma.$queryRaw`
      SELECT "primaryPolicy" AS policy,
             count(*)::int AS proposals,
             count(*) FILTER (WHERE "pairwiseShown")::int AS pairwise_shown,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" = "primaryPolicy")::int AS kept_primary,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL AND "chosenByUser" <> "primaryPolicy")::int AS chose_alternative,
             count(*) FILTER (WHERE "acceptedWithoutModification")::int AS accepted_unmodified,
             count(*) FILTER (WHERE "firstModifiedAt" IS NOT NULL)::int AS modified
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Proposals");
    console.table(tables.proposals);

    tables.funnel = (await prisma.$queryRaw`
      SELECT p."primaryPolicy" AS policy,
             count(*) FILTER (WHERE p."pairwiseShown")::int AS offered,
             count(*) FILTER (WHERE p."pairwiseShown" AND EXISTS (
               SELECT 1 FROM "ClientEvent" e
               WHERE e."slotProposalId" = p.id AND e.kind = 'OFFER_SHOWN'))::int AS shown,
             count(*) FILTER (WHERE p."pairwiseShown" AND p."chosenByUser" IS NOT NULL)::int AS tapped,
             count(*) FILTER (WHERE p."pairwiseShown" AND p."chosenByUser" = 'LINUCB')::int AS picked_linucb,
             count(*) FILTER (WHERE p."pairwiseShown" AND p."chosenByUser" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "SessionEvent" s
               WHERE s."sessionId" = p."sessionId" AND s."eventType" = 'START'))::int AS started
      FROM "SlotProposal" p
      WHERE p."placementSource" = 'PYTHON' AND p."timestamp" >= ${since}
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Offer funnel by primary policy");
    console.table(tables.funnel);

    tables.channels = (await prisma.$queryRaw`
      SELECT COALESCE(e.channel, 'NONE') AS channel,
             count(DISTINCT e."slotProposalId")::int AS offers_shown
      FROM "ClientEvent" e
      WHERE e.kind = 'OFFER_SHOWN' AND e."occurredAt" >= ${since}
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Offers shown by channel");
    console.table(tables.channels);

    tables.weeks = (await prisma.$queryRaw`
      SELECT date_trunc('week', "timestamp")::date AS week,
             "primaryPolicy" AS policy,
             count(*) FILTER (WHERE "pairwiseShown")::int AS offered,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL)::int AS tapped
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1, 2 ORDER BY 1, 2`) as Row[];
    console.log("Offers per week");
    console.table(tables.weeks);

    tables.observations = (await prisma.$queryRaw`
      SELECT CASE WHEN "observationCount" < 5 THEN '0-4'
                  WHEN "observationCount" < 20 THEN '5-19'
                  ELSE '20+' END AS observations,
             "primaryPolicy" AS policy,
             count(*)::int AS proposals,
             count(*) FILTER (WHERE "pairwiseShown")::int AS offered,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL)::int AS tapped
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1, 2 ORDER BY 1, 2`) as Row[];
    console.log("Offers by observation count (cold-start bucket)");
    console.table(tables.observations);

    tables.alignment = (await prisma.$queryRaw`
      WITH placed AS (
        SELECT p."primaryPolicy" AS policy, p."userId",
               p."proposedStartTime" AS t,
               p."proposedStartTime" + interval '12 hours' AS t_shifted
        FROM "SlotProposal" p
        WHERE p."placementSource" = 'PYTHON' AND p."proposedStartTime" IS NOT NULL
          AND p."timestamp" >= ${since}
      )
      SELECT policy,
             count(*)::int AS proposals,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "ClientEvent" e
               WHERE e."userId" = pl."userId" AND e.kind = 'APP_OPEN'
                 AND e."occurredAt"::date <> pl.t::date
                 AND abs(extract(epoch FROM (e."occurredAt"::time - pl.t::time))) <= 3600
             ))::int AS aligned,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "ClientEvent" e
               WHERE e."userId" = pl."userId" AND e.kind = 'APP_OPEN'
                 AND e."occurredAt"::date <> pl.t_shifted::date
                 AND abs(extract(epoch FROM (e."occurredAt"::time - pl.t_shifted::time))) <= 3600
             ))::int AS aligned_shifted_12h
      FROM placed pl
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Activity alignment (leave-one-day-out, +-60 min, UTC; shifted baseline)");
    console.table(tables.alignment);

    // Start rate: placed sessions whose slot has passed, and how many of them
    // have a START (ADR-0035). A session still ahead has no outcome yet.
    tables.outcomes = (await prisma.$queryRaw`
      WITH latest AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "primaryPolicy"
        FROM "SlotProposal"
        WHERE "sessionId" IS NOT NULL AND "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
        ORDER BY "sessionId", "timestamp" DESC
      ),
      due AS (
        SELECT l."primaryPolicy", l."sessionId"
        FROM latest l
        JOIN "Session" s ON s.id = l."sessionId"
        WHERE s."scheduledStartTime" + make_interval(mins => s."durationMinutes") <= now()
      )
      SELECT d."primaryPolicy" AS policy,
             count(DISTINCT d."sessionId")::int AS due,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'START')::int AS started,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'MOVE')::int AS moved,
             round((count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'START'))::numeric
               / nullif(count(DISTINCT d."sessionId"), 0), 3)::float AS "startRate"
      FROM due d
      LEFT JOIN "SessionEvent" e ON e."sessionId" = d."sessionId"
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Start rate by primary policy (due sessions only)");
    console.table(tables.outcomes);

    tables.learning = (await prisma.$queryRaw`
      SELECT "arm"::text AS arm, count(*)::int AS users, sum("version")::int AS updates
      FROM "BanditArmState"
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("LinUCB arm updates persisted");
    console.table(tables.learning);
  } finally {
    await app.close();
  }

  const out = arg("--csv");
  if (out) {
    writeFileSync(out, toCsv(tables));
    console.log(`CSV written to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
