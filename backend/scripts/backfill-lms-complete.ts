/**
 * One-off repair: check off LMS assignments that were submitted before ingestion
 * completed them.
 *
 * The materializer now completes an assignment when it first sees the
 * submission. Rows already stamped `submittedAt` keep `completedAt` null, so
 * they earn no sparks. This writes `completedAt` and the `COMPLETE` event.
 *
 *   pnpm --filter backend backfill:lms-complete            # check them off
 *   pnpm --filter backend backfill:lms-complete --dry-run  # only count them
 *
 * Idempotent: only open, unskipped rows with `submittedAt` are written.
 * `occurredAt` is now, so the event falls inside the current egg window.
 * Connects to `.env.dev` by default (point elsewhere with `dotenv -e <file>`).
 */
import { PrismaClient } from "../generated/prisma/client";
import { databaseUrl } from "../src/common/config/connections";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient({
    datasourceUrl: databaseUrl((key) => process.env[key]),
  });
  try {
    const rows = await prisma.session.findMany({
      where: {
        type: "ASSIGNMENT",
        source: "LMS",
        deleted: false,
        skipped: false,
        completedAt: null,
        submittedAt: { not: null },
      },
      select: {
        id: true,
        userId: true,
        durationMinutes: true,
        scheduledStartTime: true,
      },
    });
    console.log(`${rows.length} submitted LMS assignment(s) not checked off`);
    if (dryRun) return;

    const now = new Date();
    for (const row of rows) {
      await prisma.$transaction([
        prisma.session.update({
          where: { id: row.id },
          data: { completedAt: now },
        }),
        prisma.sessionEvent.create({
          data: {
            sessionId: row.id,
            userId: row.userId,
            eventType: "COMPLETE",
            newSnapshot: {
              scheduledStartTime: row.scheduledStartTime?.toISOString() ?? null,
              durationMinutes: row.durationMinutes,
              tags: [],
              type: "ASSIGNMENT",
            },
          },
        }),
      ]);
    }
    console.log(`checked off ${rows.length} assignment(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
