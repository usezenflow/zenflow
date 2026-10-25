import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { SessionCrudService } from "./session-crud.service";
import {
  CHIP_EVIDENCE_MIN,
  PlacementChipsService,
  partOfDay,
} from "./placement-chips.service";

const USER = { id: "u1", timezone: "UTC" } as User;

// Friday 2026-10-30 is a weekday; the block runs 17:00 to 18:00 UTC.
const TASK = {
  id: "task-1",
  scheduledStartTime: "2026-10-30T17:00:00.000Z",
  durationMinutes: 60,
  deadline: "2026-11-02T18:00:00.000Z",
};

function build(opts: { sessions?: object[]; doneRows?: object[] } = {}) {
  const crud = {
    list: jest.fn().mockResolvedValue({ sessions: opts.sessions ?? [] }),
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(opts.doneRows ?? []),
  };
  const service = new PlacementChipsService(
    prisma as unknown as PrismaService,
    crud as unknown as SessionCrudService,
  );
  return { service, crud, prisma };
}

const texts = (chips: { text: string }[]) => chips.map((c) => c.text);

describe("PlacementChipsService single trust sentence", () => {
  it("names deadline with no clashes when no personal evidence", async () => {
    const { service } = build();

    const chips = await service.forTask(TASK, USER);

    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe("Before your Monday 18:00 deadline, no clashes");
    expect(chips[0].tier).toBe(1);
  });

  it("names deadline without 'no clashes' when another session overlaps", async () => {
    const { service } = build({
      sessions: [
        {
          id: "lec-1",
          title: "Algorithms",
          scheduledStartTime: "2026-10-30T16:30:00.000Z",
          durationMinutes: 60,
        },
      ],
    });

    const chips = await service.forTask(TASK, USER);

    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe("Before your Monday 18:00 deadline");
    expect(chips[0].tier).toBe(1);
  });

  it("shows 'No clashes' when no deadline and no overlaps", async () => {
    const { service } = build();

    const chips = await service.forTask({ ...TASK, deadline: null }, USER);

    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe("No clashes");
    expect(chips[0].tier).toBe(1);
  });

  it("shows cold start copy when no personal evidence and clashes exist", async () => {
    const { service } = build({
      sessions: [
        {
          id: "lec-1",
          title: "Algorithms",
          scheduledStartTime: "2026-10-30T16:30:00.000Z",
          durationMinutes: 60,
        },
      ],
    });

    const chips = await service.forTask({ ...TASK, deadline: null }, USER);

    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe(
      "Keep it, or move it, so Zenflow learns when you work best.",
    );
    expect(chips[0].tier).toBe(3);
  });
});

describe("PlacementChipsService personal evidence", () => {
  it("shows personal claim when tier 2 evidence exists", async () => {
    const { service } = build({
      doneRows: [
        { isoDow: 5, hour: 18, n: 7 },
        { isoDow: 2, hour: 9, n: 2 },
      ],
    });

    const chips = await service.forTask(TASK, USER);

    expect(chips).toHaveLength(1);
    expect(chips[0].tier).toBe(2);
    expect(chips[0].text).toBe(
      "You kept 7 of 9 suggestions on weekdays in the evening",
    );
  });

  it("never renders tier 2 claim under evidence bar", async () => {
    for (let total = 0; total < CHIP_EVIDENCE_MIN; total++) {
      const { service } = build({
        doneRows: total === 0 ? [] : [{ isoDow: 5, hour: 18, n: total }],
      });

      const chips = await service.forTask(TASK, USER);

      expect(chips.some((c) => c.tier === 2)).toBe(false);
      expect(texts(chips).some((t) => t.startsWith("You finished"))).toBe(
        false,
      );
    }
  });

  it("says nothing personal when bucket is under 60%", async () => {
    const { service } = build({
      doneRows: [
        { isoDow: 5, hour: 18, n: 3 },
        { isoDow: 1, hour: 9, n: 4 },
        { isoDow: 3, hour: 9, n: 3 },
      ],
    });

    const chips = await service.forTask(TASK, USER);

    expect(chips).toHaveLength(1);
    expect(chips[0].tier).toBe(1);
    expect(chips[0].text).toBe("Before your Monday 18:00 deadline, no clashes");
  });

  it("buckets weekend hours separately", async () => {
    expect(partOfDay(4)).toBe("night");
    expect(partOfDay(5)).toBe("morning");
    expect(partOfDay(12)).toBe("afternoon");
    expect(partOfDay(17)).toBe("evening");
    expect(partOfDay(22)).toBe("night");
  });
});
