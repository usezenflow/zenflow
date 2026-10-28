import { ConflictException } from "@nestjs/common";
import { DeviceCalendarController } from "./device-calendar.controller";

const user = { id: "user-1" } as never;
const body = {
  blocks: [
    {
      externalKey: "cal:ev",
      title: "Lab",
      start: "2026-11-03T02:10:00.000Z",
      end: "2026-11-03T03:05:00.000Z",
    },
  ],
};

describe("DeviceCalendarController", () => {
  it("refuses busy time while the phone calendar is not the target", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ calendarTarget: "NONE" }),
      },
    };
    const busy = { replace: jest.fn() };
    const controller = new DeviceCalendarController(
      prisma as never,
      busy as never,
    );

    await expect(
      controller.replaceBusy(body as never, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(busy.replace).not.toHaveBeenCalled();
  });

  it("saves the phone's busy time as device busy blocks", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ calendarTarget: "DEVICE" }),
      },
    };
    const busy = { replace: jest.fn().mockResolvedValue(undefined) };
    const controller = new DeviceCalendarController(
      prisma as never,
      busy as never,
    );

    await controller.replaceBusy(body, user);
    expect(busy.replace).toHaveBeenCalledWith("user-1", "DEVICE", [
      {
        externalKey: "cal:ev",
        title: "Lab",
        start: new Date("2026-11-03T02:10:00.000Z"),
        end: new Date("2026-11-03T03:05:00.000Z"),
      },
    ]);
  });
});
