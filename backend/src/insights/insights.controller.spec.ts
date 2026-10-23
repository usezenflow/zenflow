import type { Server } from "http";
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { InsightsResponse } from "@zenflow/shared";
import request from "supertest";
import { CookieAuthGuard } from "../auth/guards";
import { PrismaService } from "../prisma/prisma.service";
import { InsightsController } from "./insights.controller";
import { InsightsService } from "./insights.service";

const USER = { id: "user-1", timezone: "Asia/Saigon" };

/** Stands in for the cookie session: attaches the user and lets the request through. */
const fakeSession: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest<{ user?: unknown }>().user = USER;
    return true;
  },
};

interface InsightsBody {
  success: boolean;
  data: InsightsResponse;
}

describe("InsightsController", () => {
  let app: INestApplication;
  let prisma: {
    $queryRaw: jest.Mock;
    session: { aggregate: jest.Mock; findMany: jest.Mock };
    sessionEvent: { count: jest.Mock };
  };

  const getInsights = (query: Record<string, string> = {}) =>
    request(app.getHttpServer() as Server)
      .get("/users/me/insights")
      .query(query);

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ count: 0 }])),
      session: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _sum: { durationMinutes: null } }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      sessionEvent: { count: jest.fn(() => Promise.resolve(0)) },
    };
    const module = await Test.createTestingModule({
      controllers: [InsightsController],
      providers: [
        InsightsService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(CookieAuthGuard)
      .useValue(fakeSession)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the insights envelope for a valid window", async () => {
    const res = await getInsights({
      from: "2026-10-01",
      to: "2026-10-07",
    }).expect(200);

    const body = res.body as InsightsBody;
    expect(body.success).toBe(true);
    expect(body.data.window).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(body.data.focus).toHaveLength(168);
    expect(body.data.recap).toEqual({
      plannedMinutes: 0,
      doneMinutes: 0,
      notThisTimeCount: 0,
      onTimeCount: 0,
    });
    expect(body.data.buffers).toEqual([]);
  });

  it("accepts a window of 92 inclusive days", async () => {
    await getInsights({ from: "2026-07-01", to: "2026-09-30" }).expect(200);
  });

  it("rejects a window over 92 days before any query runs", async () => {
    await getInsights({ from: "2026-06-30", to: "2026-09-30" }).expect(400);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.session.aggregate).not.toHaveBeenCalled();
  });

  it("rejects from after to", async () => {
    await getInsights({ from: "2026-10-08", to: "2026-10-07" }).expect(400);
  });

  it.each([
    ["a date that does not exist", { from: "2026-02-30", to: "2026-03-01" }],
    ["a non-date string", { from: "yesterday", to: "2026-10-07" }],
    [
      "a timestamp instead of a date",
      { from: "2026-10-01T00:00:00Z", to: "2026-10-07" },
    ],
    [
      "an unknown parameter",
      { from: "2026-10-01", to: "2026-10-07", user: "x" },
    ],
  ])("rejects %s", async (_label, query) => {
    await getInsights(query).expect(400);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("defaults to the last seven days when no dates are given", async () => {
    const res = await getInsights().expect(200);

    const { window } = (res.body as InsightsBody).data;
    expect(window.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.from < window.to).toBe(true);
  });
});
