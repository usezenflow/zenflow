/**
 * One-off backfill: enqueue automatic prep plans for EXAM/ASSIGNMENT rows that
 * existed before the materializer hook started firing (level-up plan, Phase 1).
 *
 * Only parents that are:
 *   - not deleted,
 *   - not submitted,
 *   - still in the future (`scheduledStartTime > now`),
 *   - have no prep plan row yet (`prepForSessionId` is null for every session),
 *
 * get a job. The job id from {@link prepJobId} makes the enqueue idempotent.
 *
 *   pnpm --filter backend backfill:prep-plans            # enqueue them
 *   pnpm --filter backend backfill:prep-plans --dry-run  # only count them
 *
 * Connects to `.env.dev` by default; point elsewhere with `dotenv -e <file>`.
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { QueueService } from "../src/queue/queue.service";
import { PREP_QUEUE, prepJobId } from "../src/queue/queues";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.time("total");
  console.log("starting backfill script...");
  const t0 = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  console.log(`app context created in ${Date.now() - t0}ms`);
  try {
    const t1 = Date.now();
    const prisma = app.get(PrismaService);
    console.log(`got prisma service in ${Date.now() - t1}ms`);
    const t2 = Date.now();
    const queues = app.get(QueueService);
    console.log(`got queue service in ${Date.now() - t2}ms`);
    const now = new Date();

    const parents = await prisma.$queryRaw<
      { id: string; userId: string; title: string; type: string }[]
    >`
      SELECT s.id, s."userId", s.title, s.type
      FROM "Session" s
      WHERE s.type IN ('EXAM', 'ASSIGNMENT')
        AND s.deleted = false
        AND s."submittedAt" IS NULL
        AND s."scheduledStartTime" > ${now}
        AND NOT EXISTS (
          SELECT 1 FROM "Session" p
          WHERE p."prepForSessionId" = s.id
        )
      ORDER BY s."scheduledStartTime" ASC
    `;
    console.log("query complete");

    console.log(
      `${parents.length} EXAM/ASSIGNMENT row(s) eligible for a prep plan`,
    );
    if (dryRun || parents.length === 0) return;

    let enqueued = 0;
    let failed = 0;
    for (const parent of parents) {
      const t = Date.now();
      const jobId = prepJobId(parent.id);
      try {
        const job = await queues.enqueueBestEffort(
          PREP_QUEUE,
          { userId: parent.userId, parentSessionId: parent.id },
          { jobId },
        );
        if (job) {
          console.log(
            `enqueued ${jobId} (${parent.type} ${parent.title}) in ${Date.now() - t}ms`,
          );
          enqueued++;
        } else {
          console.error(`failed to enqueue ${jobId} (${parent.type} ${parent.title}): returned null`);
          failed++;
        }
      } catch (err) {
        console.error(`failed to enqueue ${jobId}:`, err);
        failed++;
      }
    }

    console.log(`done: ${enqueued} enqueued, ${failed} failed`);
    if (failed) process.exitCode = 1;
  } finally {
    const tClose = Date.now();
    console.log("closing app context...");
    await app.close();
    console.log(`app context closed in ${Date.now() - tClose}ms`);
    console.timeEnd("total");
    process.exit(process.exitCode ?? 0);
  }
}

void main();
