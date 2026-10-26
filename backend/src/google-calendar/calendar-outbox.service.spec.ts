import { CalendarOutboxService, backoffMs } from "./calendar-outbox.service";

type Exec = { sql: string; values: unknown[] };

function fakes(summary: unknown) {
  const executed: Exec[] = [];
  const counts: number[] = [];
  const prisma = {
    $executeRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        executed.push({
          sql: strings.join("?").replace(/\s+/g, " ").trim(),
          values,
        });
        return Promise.resolve(counts.shift() ?? 1);
      },
    ),
  };
  const sync = {
    syncUser: jest.fn(() => Promise.resolve(summary)),
  };
  const service = new CalendarOutboxService(
    prisma as never,
    sync as never,
    { get: () => undefined } as never,
  );
  const row = {
    userId: "u1",
    dirtyAt: new Date("2026-10-26T01:00:00Z"),
    attempts: 0,
  };
  const run = () =>
    (
      service as unknown as { process: (r: typeof row) => Promise<void> }
    ).process(row);
  return { executed, counts, sync, run, row };
}

describe("backoffMs", () => {
  it("doubles from 30 seconds and caps at an hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(60 * 60_000);
  });
});

describe("CalendarOutboxService.process", () => {
  const ok = { written: 1, deleted: 0, failed: 0, retryable: 0 };

  it("removes the row after a clean sync", async () => {
    const { executed, run, sync } = fakes(ok);
    await run();
    expect(sync.syncUser).toHaveBeenCalledWith("u1");
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/^DELETE FROM "CalendarSyncOutbox"/);
  });

  it("keeps the row and releases the lease when the user changed during the sync", async () => {
    const { executed, counts, run } = fakes(ok);
    counts.push(0);
    await run();
    expect(executed).toHaveLength(2);
    expect(executed[1].sql).toMatch(
      /SET "claimedUntil" = NULL, "attempts" = 0/,
    );
  });

  it("removes the row when the user has no active connection any more", async () => {
    const { executed, run } = fakes(null);
    await run();
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toMatch(/^DELETE FROM "CalendarSyncOutbox"/);
  });

  it("reschedules with backoff and records the error when a write fails", async () => {
    const { executed, run, row, sync } = fakes({ ...ok, failed: 2 });
    await run();
    expect(sync.syncUser).toHaveBeenCalledTimes(1);
    const update = executed.at(-1);
    expect(update?.sql).toMatch(
      /SET "claimedUntil" = NULL, "attempts" = \?, "lastError" = \?, "nextAttemptAt" = \?/,
    );
    expect(update?.values[0]).toBe(row.attempts + 1);
    expect(String(update?.values[1])).toContain("2 failed");
  });

  it("reschedules when the sync throws", async () => {
    const { executed, sync, run } = fakes(ok);
    sync.syncUser.mockRejectedValueOnce(new Error("google 503"));
    await run();
    expect(executed.at(-1)?.values[1]).toBe("google 503");
  });
});
