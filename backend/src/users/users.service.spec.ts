import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { CommuteDefaultsService } from "../commute/commute-defaults.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";
import type { User } from "../../generated/prisma";

const user = { id: "user-1" } as User;

const commuteDefaults = { applyQuietly: jest.fn() };

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

async function makeService(update: jest.Mock) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: CommuteDefaultsService, useValue: commuteDefaults },
      {
        provide: PrismaService,
        useValue: {
          user: {
            update,
            findUnique: jest.fn(() => ({ timezone: "Asia/Ho_Chi_Minh" })),
          },
          session: { findMany: jest.fn(() => []) },
          sessionSeries: { update: jest.fn() },
          $transaction: (ops: unknown[]) => Promise.all(ops),
        },
      },
    ],
  }).compile();
  return module.get<UsersService>(UsersService);
}

describe("UsersService.update", () => {
  it("persists a name change (timezone is no longer editable here)", async () => {
    const update = jest.fn(
      (args: UpdateArgs): { id: string } & Record<string, unknown> => ({
        id: user.id,
        ...args.data,
      }),
    );
    const service = await makeService(update);

    await service.update(user.id, { name: "New Name" });

    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { name: "New Name" },
    });
  });

  it("maps lang to the DB enum and persists timezone + default reminder", async () => {
    const update = jest.fn((args: UpdateArgs) => ({
      id: user.id,
      ...args.data,
    }));
    const service = await makeService(update);

    await service.update(user.id, {
      timezone: "Asia/Tokyo",
      lang: "en",
      defaultReminderMinutes: 0,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        timezone: "Asia/Tokyo",
        lang: "EN_US",
        defaultReminderMinutes: 0,
      },
    });
  });

  it("throws NotFoundException when the user doesn't exist", async () => {
    const update = jest.fn(() => {
      throw new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: PostgresErrorCode.RecordNotFound,
        clientVersion: "test",
      });
    });
    const service = await makeService(update);

    await expect(
      service.update("missing", { name: "New Name" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("UsersService.update onboarding", () => {
  it("stamps onboardedAt only when still null, and never writes the flag as a column", async () => {
    const update = jest.fn((args: UpdateArgs) => ({
      id: user.id,
      ...args.data,
    }));
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: CommuteDefaultsService, useValue: commuteDefaults },
        { provide: PrismaService, useValue: { user: { update, updateMany } } },
      ],
    }).compile();
    const service = module.get(UsersService);

    await service.update(user.id, { onboarded: true });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: user.id, onboardedAt: null },
      data: { onboardedAt: expect.any(Date) as Date },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {},
    });
  });
});

describe("UsersService.update commute", () => {
  beforeEach(() => commuteDefaults.applyQuietly.mockClear());

  async function make() {
    const update = jest.fn((args: UpdateArgs) => ({
      id: user.id,
      ...args.data,
    }));
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: CommuteDefaultsService, useValue: commuteDefaults },
        { provide: PrismaService, useValue: { user: { update } } },
      ],
    }).compile();
    return module.get(UsersService);
  }

  it("redoes the commutes when the home changes", async () => {
    const service = await make();

    await service.update(user.id, {
      homeLocation: "Home",
      homeLat: 11.94,
      homeLng: 108.43,
    });

    expect(commuteDefaults.applyQuietly).toHaveBeenCalledWith(user.id);
  });

  it("redoes the commutes when the vehicle changes", async () => {
    const service = await make();

    await service.update(user.id, { defaultTransport: "BIKE" });

    expect(commuteDefaults.applyQuietly).toHaveBeenCalledWith(user.id);
  });

  it("leaves them alone for an unrelated change", async () => {
    const service = await make();

    await service.update(user.id, { name: "New Name" });

    expect(commuteDefaults.applyQuietly).not.toHaveBeenCalled();
  });
});
