import type {
  CreateSessionResponse,
  Session,
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
 * Scheduler e2e: placement, validation, infeasible handling, TASK series and
 * recurring fixed sessions through the real API, Postgres and Redis (the
 * `compose.test.yml --profile queue` stack, same as `queue/queue-flow`).
 *
 * No bandit service is configured, so every placement runs on the frozen TS
 * fallback and carries `schedulingDegraded: true`. The Python primary path is
 * covered by `sessions-bandit.e2e-spec.ts`. Each test signs up its own student,
 * so nothing leaks between tests.
 */
jest.setTimeout(180_000);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SLOT = 15 * 60_000;
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
/** The next quarter-hour boundary at least `minAhead` ms from now. */
const nextSlot = (minAhead = 0) =>
  Math.ceil((Date.now() + minAhead) / SLOT) * SLOT;
type SessionDto = CreateSessionResponse;
const startOf = (s: Pick<Session, "scheduledStartTime">) =>
  Date.parse(s.scheduledStartTime as string);
const endOf = (s: Pick<Session, "scheduledStartTime" | "durationMinutes">) =>
  startOf(s) + s.durationMinutes * 60_000;
type Timed = Pick<Session, "scheduledStartTime" | "durationMinutes">;
const overlaps = (a: Timed, b: Timed) =>
  startOf(a) < endOf(b) && startOf(b) < endOf(a);
const data = <T = SessionDto>(res: { body: unknown }) =>
  (res.body as { data: T }).data;

const create = (student: Student, body: Record<string, unknown>) =>
  student.agent.post(SESSIONS).send(body);
const task = (over: Record<string, unknown> = {}) => ({
  type: "TASK",
  title: "Revise graphs",
  durationMinutes: 60,
  deadline: iso(Date.now() + 3 * DAY),
  ...over,
});
async function list(
  student: Student,
  view: "day" | "week" | "month",
  at: number,
) {
  const res = await student.agent
    .get(SESSIONS)
    .query({ view, date: iso(at).slice(0, 10) })
    .expect(200);
  return data<SessionsListResponse>(res).sessions;
}

describe("creating a TASK", () => {
  it("places it on the 15-minute grid before its deadline, on the fallback placer", async () => {
    const student = await signUp("place");
    const deadline = Date.now() + 3 * DAY;
    const res = await create(student, task({ deadline: iso(deadline) })).expect(
      201,
    );
    const body = res.body as { success: boolean; message: string };
    expect(body.success).toBe(true);
    const session = data(res);
    expect(session.scheduledStartTime).not.toBeNull();
    const start = startOf(session);
    expect(start % SLOT).toBe(0);
    expect(start).toBeGreaterThanOrEqual(Date.now() - SLOT);
    expect(endOf(session)).toBeLessThanOrEqual(deadline);
    expect(session.schedulingDegraded).toBe(true);
    expect(session.late).toBe(false);
  });

  it("shows up in the calendar listing", async () => {
    const student = await signUp("listing");
    const created = data(await create(student, task()).expect(201));
    const sessions = await list(student, "week", startOf(created));
    expect(sessions.map((s) => s.id)).toContain(created.id);
  });

  it("keeps a new task clear of fixed sessions", async () => {
    const student = await signUp("clear");
    const lectureStart = nextSlot(SLOT);
    const lecture = data(
      await create(student, {
        type: "LECTURE",
        title: "Algorithms",
        durationMinutes: 120,
        scheduledStartTime: iso(lectureStart),
      }).expect(201),
    );
    const placed = data(
      await create(student, task({ deadline: iso(Date.now() + DAY) })).expect(
        201,
      ),
    );
    expect(overlaps(placed, lecture)).toBe(false);
  });

  it("does not stack two tasks on the same slot", async () => {
    const student = await signUp("stack");
    const a = data(await create(student, task({ title: "A" })).expect(201));
    const b = data(await create(student, task({ title: "B" })).expect(201));
    expect(overlaps(a, b)).toBe(false);
  });

  it("requires a login", async () => {
    await request(API_URL).post(SESSIONS).send(task()).expect(401);
  });

  describe("validation", () => {
    let student: Student;
    beforeAll(async () => {
      student = await signUp("validate");
    });
    const rejected = async (body: Record<string, unknown>, message: RegExp) => {
      const res = await create(student, body).expect(400);
      expect(JSON.stringify(res.body)).toMatch(message);
      const sessions = await list(student, "month", Date.now());
      expect(sessions).toEqual([]);
    };

    it("rejects a duration that is not a multiple of 15", () =>
      rejected(task({ durationMinutes: 20 }), /divisible by 15/));
    it("rejects a task without a deadline", () =>
      rejected(task({ deadline: undefined }), /deadline/));
    it("rejects a deadline too close to fit the task", () =>
      rejected(task({ deadline: iso(Date.now() + 10 * 60_000) }), /deadline/i));
    it("rejects an unknown field", () =>
      rejected(task({ colour: "red" }), /colour should not exist/));
    it("rejects a title over 60 characters", () =>
      rejected(task({ title: "x".repeat(61) }), /at most 60 characters/));
    it("rejects a fixed session without a start", () =>
      rejected(
        { type: "LECTURE", title: "L", durationMinutes: 60 },
        /scheduledStartTime/,
      ));
    it("rejects an unknown type", () =>
      rejected(task({ type: "NAP" }), /type/));
  });
});

describe("when the deadline cannot be met", () => {
  /** A DND wall from now to well past a 3-hour deadline, so no conflict-free slot is left before it. */
  async function wall(student: Student) {
    await create(student, {
      type: "DND",
      title: "Away",
      durationMinutes: 24 * 60,
      scheduledStartTime: iso(Math.floor(Date.now() / SLOT) * SLOT),
    }).expect(201);
  }
  const tight = () => task({ deadline: iso(Date.now() + 3 * HOUR) });

  it("answers 409 SCHEDULE_INFEASIBLE with both options and persists nothing", async () => {
    const student = await signUp("infeasible");
    await wall(student);
    const res = await create(student, tight()).expect(409);
    expect(res.body).toMatchObject({
      success: false,
      code: "SCHEDULE_INFEASIBLE",
      options: ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"],
    });
    const sessions = await list(student, "week", Date.now());
    expect(sessions.filter((s) => s.type === "TASK")).toEqual([]);
  });

  // The frozen fallback has one answer for either policy: the first free slot
  // after the deadline. The policies differ only on the Python primary path
  // (`sessions-bandit.e2e-spec.ts`).
  it.each(["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"])(
    "%s still places it, in the first free slot after the deadline",
    async (infeasiblePolicy) => {
      const student = await signUp(`policy-${infeasiblePolicy.toLowerCase()}`);
      await wall(student);
      const deadline = Date.now() + 3 * HOUR;
      const placed = data(
        await create(student, {
          ...task({ deadline: iso(deadline) }),
          infeasiblePolicy,
        }).expect(201),
      );
      expect(startOf(placed) % SLOT).toBe(0);
      expect(endOf(placed)).toBeGreaterThan(deadline);
      expect(placed.late).toBe(true);
      expect(placed.schedulingDegraded).toBe(true);
    },
  );

  it("rejects an unknown policy", async () => {
    const student = await signUp("policy");
    await create(student, { ...tight(), infeasiblePolicy: "SHRUG" }).expect(
      400,
    );
  });
});

describe("a recurring fixed session", () => {
  const first = () => nextSlot(2 * DAY);
  const recurring = (over: Record<string, unknown> = {}) => ({
    type: "LECTURE",
    title: "Weekly lab",
    durationMinutes: 60,
    scheduledStartTime: iso(first()),
    rrule: "FREQ=WEEKLY;COUNT=4",
    ...over,
  });
  const occurrences = async (student: Student) =>
    (await list(student, "month", first()))
      .concat(await list(student, "month", first() + 28 * DAY))
      .filter((s) => s.type === "LECTURE")
      .filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i)
      .sort((a, b) => startOf(a) - startOf(b));

  it("fans out one occurrence per date, with ids tied to the series", async () => {
    const student = await signUp("rrule");
    const created = data(await create(student, recurring()).expect(201));
    expect(created.seriesId).not.toBeNull();
    const found = await occurrences(student);
    expect(found).toHaveLength(4);
    for (const occ of found) {
      expect(occ.id.startsWith(`${created.seriesId}::`)).toBe(true);
      expect(occ.id).toBe(`${created.seriesId}::${occ.scheduledStartTime}`);
    }
    expect(startOf(found[1]) - startOf(found[0])).toBe(7 * DAY);
  });

  it("rejects a malformed rule", async () => {
    const student = await signUp("rrule-bad");
    await create(student, recurring({ rrule: "EVERY OTHER TUESDAY" })).expect(
      400,
    );
  });

  it("edits the whole series from one occurrence", async () => {
    const student = await signUp("rrule-edit");
    await create(student, recurring()).expect(201);
    const [one] = await occurrences(student);
    await student.agent
      .patch(`${SESSIONS}/${encodeURIComponent(one.id)}`)
      .send({ title: "Renamed lab", scope: "series" })
      .expect(200);
    const titles = (await occurrences(student)).map((s) => s.title);
    expect(titles).toEqual(Array(4).fill("Renamed lab"));
  });

  it("deleting one occurrence leaves the rest of the series", async () => {
    const student = await signUp("rrule-one");
    await create(student, recurring()).expect(201);
    const all = await occurrences(student);
    await student.agent
      .delete(`${SESSIONS}/${encodeURIComponent(all[1].id)}`)
      .expect(200);
    const left = await occurrences(student);
    expect(left.map((s) => s.id)).toEqual([all[0].id, all[2].id, all[3].id]);
  });

  it("truncating ends the series before the chosen occurrence", async () => {
    const student = await signUp("rrule-trunc");
    const created = data(await create(student, recurring()).expect(201));
    const all = await occurrences(student);
    await student.agent
      .delete(`${SESSIONS}/series/${created.seriesId}/truncate`)
      .query({ from: all[2].scheduledStartTime })
      .expect(200);
    expect((await occurrences(student)).map((s) => s.id)).toEqual([
      all[0].id,
      all[1].id,
    ]);
  });

  it("deleting the series removes every occurrence", async () => {
    const student = await signUp("rrule-all");
    const created = data(await create(student, recurring()).expect(201));
    await student.agent
      .delete(`${SESSIONS}/series/${created.seriesId}`)
      .expect(200);
    expect(await occurrences(student)).toEqual([]);
  });
});
