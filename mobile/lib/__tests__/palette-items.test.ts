import type { BulkCreateItemResult, CreateSessionInput } from "@zenflow/shared";
import { MAX_TASK_MINUTES } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { pairOffers } from "../palette/gate";
import { buildItems, createdLines, resultsFor } from "../palette/items";

const now = new Date(2026, 9, 27, 10, 0);
const day = 86_400_000;

describe("buildItems", () => {
  it("is null with no lines", () => expect(buildItems([], now)).toBeNull());
  it("a bare title is a task a week out with the default length", () => {
    const r = buildItems([{ title: "Toán" }], now)!;
    expect(r.items[0]).toMatchObject({
      type: "TASK",
      title: "Toán",
      durationMinutes: 60,
    });
    expect(Date.parse((r.items[0] as { deadline: string }).deadline)).toBe(
      now.getTime() + 7 * day,
    );
  });
  it("uses the learned length before the default, a stated one before both", () => {
    expect(
      buildItems([{ title: "Toán" }], now, () => 90)!.items[0].durationMinutes,
    ).toBe(90);
    expect(
      buildItems([{ title: "Toán", minutes: 30 }], now, () => 90)!.items[0]
        .durationMinutes,
    ).toBe(30);
  });
  it("a fixed type needs a start", () => {
    expect(buildItems([{ title: "Thi", type: "EXAM" }], now)).toBeNull();
    const start = new Date(2026, 9, 30, 8);
    expect(
      buildItems([{ title: "Thi", type: "EXAM", start }], now)!.items[0],
    ).toMatchObject({
      type: "EXAM",
      durationMinutes: 120,
      scheduledStartTime: start.toISOString(),
    });
  });
  it("carries window and notBefore", () => {
    const notBefore = new Date(2026, 9, 28);
    const i = buildItems([{ title: "Lý", window: "MORNING", notBefore }], now)!
      .items[0];
    expect(i).toMatchObject({
      window: "MORNING",
      notBefore: notBefore.toISOString(),
    });
  });
  it("splits a task over the cap into owned chunks", () => {
    const r = buildItems(
      [
        { title: "Lý" },
        {
          title: "Toán",
          minutes: 600,
          deadline: new Date(now.getTime() + 5 * day),
        },
      ],
      now,
    )!;
    expect(r.owner).toEqual([0, 1, 1, 1]);
    expect(r.items.slice(1).map((i) => i.durationMinutes)).toEqual([
      180, 180, 240,
    ]);
    expect(r.items.slice(1).map((i) => i.title)).toEqual([
      "Toán 1/3",
      "Toán 2/3",
      "Toán 3/3",
    ]);
  });
  it("a length at the cap is not split", () => {
    expect(
      buildItems([{ title: "Toán", minutes: MAX_TASK_MINUTES }], now)!.items,
    ).toHaveLength(1);
  });
  it("null when the split window is too short", () => {
    expect(
      buildItems(
        [
          {
            title: "Toán",
            minutes: 600,
            deadline: new Date(now.getTime() + 3_600_000),
          },
        ],
        now,
      ),
    ).toBeNull();
  });
});

describe("results", () => {
  const results: BulkCreateItemResult[] = [
    { index: 0, status: "CREATED", id: "a", scheduledStartTime: null },
    { index: 1, status: "ERROR", code: "X", message: "no" },
    { index: 2, status: "CREATED", id: "c", scheduledStartTime: null },
  ];
  it("maps results back to lines", () => {
    expect(resultsFor(results, [0, 1, 1], 1).map((r) => r.index)).toEqual([
      1, 2,
    ]);
    expect([...createdLines(results, [0, 1, 1])]).toEqual([0, 1]);
  });
});

describe("pairOffers", () => {
  const items = [
    {
      type: "TASK",
      title: "a",
      durationMinutes: 60,
      deadline: "2026-11-01T00:00:00Z",
    },
  ] as CreateSessionInput[];
  it("offers the most divergent pairs only", () => {
    const r: BulkCreateItemResult[] = [
      {
        index: 0,
        status: "CREATED",
        id: "a",
        scheduledStartTime: null,
        pairwise: {
          slotProposalId: "p",
          primary: "2026-10-27T08:00:00Z",
          alternative: "2026-10-27T08:30:00Z",
        },
      },
      {
        index: 1,
        status: "CREATED",
        id: "b",
        scheduledStartTime: null,
        pairwise: {
          slotProposalId: "q",
          primary: "2026-10-27T08:00:00Z",
          alternative: "2026-10-27T15:00:00Z",
        },
      },
    ];
    expect(pairOffers(r, items.concat(items)).map((o) => o.id)).toEqual(["b"]);
  });
});

describe("buildItems repeats and blocks", () => {
  it("makes one task per occurrence, each due that day", () => {
    const deadlines = [1, 2, 3].map(
      (d) => new Date(2026, 9, 27 + d, 0, 0, 0, -1),
    );
    const r = buildItems([{ title: "Đọc", repeatDeadlines: deadlines }], now)!;
    expect(r.items).toHaveLength(3);
    expect(r.owner).toEqual([0, 0, 0]);
  });
  it("makes a fixed series with its rule", () => {
    const r = buildItems(
      [
        {
          title: "Gym",
          type: "DND",
          start: new Date(2026, 10, 2, 18),
          rrule: "FREQ=WEEKLY;BYDAY=MO",
        },
      ],
      now,
    )!;
    expect(r.items[0]).toMatchObject({
      type: "DND",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
  });
  it("cuts a task into the asked blocks", () => {
    const r = buildItems(
      [
        {
          title: "Đồ án",
          minutes: 360,
          parts: 2,
          deadline: new Date(now.getTime() + 3 * day),
        },
      ],
      now,
    )!;
    expect(r.items.map((i) => i.durationMinutes)).toEqual([180, 180]);
    const small = buildItems(
      [
        {
          title: "Đồ án",
          minutes: 120,
          parts: 2,
          deadline: new Date(now.getTime() + 3 * day),
        },
      ],
      now,
    )!;
    expect(small.items.map((i) => i.durationMinutes)).toEqual([60, 60]);
  });
  it("is null over the bulk cap", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ title: `t${i}` }));
    expect(buildItems(many, now)).toBeNull();
  });
});
