import { createHash } from "crypto";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarFeedService } from "./calendar-feed.service";

const USER = { id: "u1", timezone: "UTC" } as User;
const NOW = new Date("2026-10-23T08:00:00.000Z");
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function build(
  opts: {
    user?: object | null;
    sessions?: object[];
    skips?: object[];
  } = {},
) {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.user === undefined ? { id: "u1", timezone: "UTC" } : opts.user,
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    session: { findMany: jest.fn().mockResolvedValue(opts.sessions ?? []) },
    sessionOccurrenceState: {
      findMany: jest.fn().mockResolvedValue(opts.skips ?? []),
    },
  };
  const service = new CalendarFeedService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe("CalendarFeedService.rotate", () => {
  it("stores only the hash and returns the path once", async () => {
    const { service, prisma } = build();

    const res = await service.rotate(USER, NOW);

    const token = res.path
      ?.replace("/api/v1/calendar/", "")
      .replace(".ics", "");
    expect(token).toBeTruthy();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        calendarFeedTokenHash: sha256(token as string),
        calendarFeedCreatedAt: NOW,
      },
    });
    expect(res.enabled).toBe(true);
  });

  it("status never returns the path", async () => {
    const { service } = build();

    const res = await service.status(USER);

    expect(res.path).toBeNull();
  });
});

describe("CalendarFeedService.render", () => {
  it("answers null for a secret no user holds", async () => {
    const { service, prisma } = build({ user: null });

    const ics = await service.render("unknown", NOW);

    expect(ics).toBeNull();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { calendarFeedTokenHash: sha256("unknown") },
      }),
    );
  });

  it("expands series around skipped occurrences and drops skipped singles", async () => {
    const skippedMonday = new Date("2026-11-02T09:00:00.000Z");
    const { service } = build({
      sessions: [
        {
          id: "rep",
          title: "Lecture",
          seriesId: "ser1",
          scheduledStartTime: new Date("2026-10-19T09:00:00.000Z"),
          durationMinutes: 90,
          skipped: false,
          series: {
            rrule: "FREQ=WEEKLY;BYDAY=MO",
            exdates: [],
            skippedFrom: null,
          },
        },
        {
          id: "task-1",
          title: "Essay",
          seriesId: null,
          scheduledStartTime: new Date("2026-10-30T17:00:00.000Z"),
          durationMinutes: 60,
          skipped: false,
          series: null,
        },
        {
          id: "gone",
          title: "Skipped",
          seriesId: null,
          scheduledStartTime: new Date("2026-10-28T10:00:00.000Z"),
          durationMinutes: 60,
          skipped: true,
          series: null,
        },
      ],
      skips: [{ seriesId: "ser1", occurrenceStart: skippedMonday }],
    });

    const ics = (await service.render("token", NOW)) ?? "";

    expect(ics).toContain("DTSTART:20261026T090000Z");
    expect(ics).toContain("DTSTART:20261109T090000Z");
    expect(ics).not.toContain("DTSTART:20261102T090000Z");
    expect(ics).toContain("UID:task-1@zenflow");
    expect(ics).toContain("DTEND:20261030T180000Z");
    expect(ics).not.toContain("SUMMARY:Skipped");
  });
});
