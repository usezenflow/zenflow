import type {
  CreateSessionResponse,
  SessionSkipResponse,
  SessionsListResponse,
} from "@zenflow/shared";
import request from "supertest";
import { PrismaClient } from "../generated/prisma";
import { connectDb } from "./queue/support/db";
import {
  API_URL,
  removeStudents,
  signUp,
  startRole,
  stop,
  type Proc,
  type Student,
} from "./queue/support/stack";

/**
 * Skipped state through the real API and Postgres: skip and undo on calendar
 * sessions and recurring occurrences, TASK rejected, no SessionEvent written.
 */
jest.setTimeout(180_000);

const SLOT = 15 * 60_000;
const DAY = 24 * 3_600_000;
const SESSIONS = "/api/v1/sessions";

let api: Proc;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = connectDb();
  api = await startRole("api");
});
afterAll(async () => {
  await stop(api);
  await removeStudents(prisma);
  await prisma.$disconnect();
});

const iso = (ms: number) => new Date(ms).toISOString();
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
const path = (id: string) => `${SESSIONS}/${encodeURIComponent(id)}/skip`;

async function lecture(student: Student, over: Record<string, unknown> = {}) {
  const start = Math.floor((Date.now() - 2 * 3_600_000) / SLOT) * SLOT;
  const res = await student.agent
    .post(SESSIONS)
    .send({
      type: "LECTURE",
      title: "Algorithms",
      durationMinutes: 60,
      scheduledStartTime: iso(start),
      ...over,
    })
    .expect(201);
  return data<CreateSessionResponse>(res);
}

async function task(student: Student, over: Record<string, unknown> = {}) {
  const res = await student.agent
    .post(SESSIONS)
    .send({
      type: "TASK",
      title: "Revise graphs",
      durationMinutes: 60,
      deadline: iso(Date.now() + 3 * DAY),
      ...over,
    })
    .expect(201);
  return data<CreateSessionResponse>(res);
}

async function skipEvents(sessionId: string) {
  return prisma.sessionEvent.count({ where: { sessionId } });
}

describe("skipping a session", () => {
  it("round-trips skip and undo without writing an event", async () => {
    const student = await signUp("skip");
    const s = await lecture(student);

    const skipped = data<SessionSkipResponse>(
      await student.agent.post(path(s.id)).expect(201),
    );
    expect(skipped.session).toMatchObject({ id: s.id, skipped: true });
    expect(await skipEvents(s.id)).toBe(0);

    const undone = data<SessionSkipResponse>(
      await student.agent.delete(path(s.id)).expect(200),
    );
    expect(undone.session).toMatchObject({ skipped: false });
  });

  it("rejects a TASK with 400", async () => {
    const student = await signUp("skip-task");
    const s = await task(student);

    await student.agent.post(path(s.id)).expect(400);
    expect(await skipEvents(s.id)).toBe(0);
  });

  it("has no completion route", async () => {
    const student = await signUp("no-complete");
    const s = await lecture(student);

    await student.agent.post(`${SESSIONS}/${s.id}/complete`).expect(404);
  });

  it("404s another student's session", async () => {
    const owner = await signUp("owner");
    const other = await signUp("other");
    const s = await lecture(owner);
    await other.agent.post(path(s.id)).expect(404);
  });

  it("requires a login", async () => {
    await request(API_URL).post(path("any")).expect(401);
  });
});

describe("recurring occurrences", () => {
  it("skips one occurrence without touching the others", async () => {
    const student = await signUp("occ");
    const rep = await lecture(student, { rrule: "FREQ=DAILY;COUNT=5" });
    const occId = `${rep.seriesId}::${rep.scheduledStartTime}`;

    const skipped = data<SessionSkipResponse>(
      await student.agent.post(path(occId)).expect(201),
    );
    expect(skipped.session).toMatchObject({
      id: occId,
      scheduledStartTime: rep.scheduledStartTime,
      skipped: true,
    });

    const listed = data<SessionsListResponse>(
      await student.agent
        .get(SESSIONS)
        .query({ view: "week", date: rep.scheduledStartTime?.slice(0, 10) })
        .expect(200),
    ).sessions.filter((s) => s.seriesId === rep.seriesId);
    expect(listed.length).toBeGreaterThan(1);
    expect(listed.filter((s) => s.skipped).map((s) => s.id)).toEqual([occId]);

    await student.agent.delete(path(occId)).expect(200);
    expect(
      await prisma.sessionOccurrenceState.count({
        where: { seriesId: rep.seriesId as string },
      }),
    ).toBe(0);
  });

  it("404s an occurrence the series does not produce", async () => {
    const student = await signUp("occ-404");
    const rep = await lecture(student, { rrule: "FREQ=DAILY;COUNT=2" });
    const start = Date.parse(rep.scheduledStartTime as string);
    const bogus = `${rep.seriesId}::${iso(start + 10 * DAY)}`;
    await student.agent.post(path(bogus)).expect(404);
  });
});
