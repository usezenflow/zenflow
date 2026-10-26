import { GoogleCalendarService } from "./google-calendar.service";

function setup(connection: unknown, verified = true) {
  const prisma = {
    calendarConnection: {
      findUnique: jest.fn().mockResolvedValue(connection),
    },
  };
  const watch = { verify: jest.fn().mockReturnValue(verified) };
  const trigger = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new GoogleCalendarService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    watch as never,
    trigger as never,
  );
  return { service, trigger };
}

const active = {
  userId: "user-1",
  status: "ACTIVE",
  channelResourceId: "res-1",
};

describe("GoogleCalendarService.onNotification", () => {
  it("queues a pull for the current channel", async () => {
    const { service, trigger } = setup(active);
    await service.onNotification("chan", "tok", "exists", "res-1");
    expect(trigger.enqueue).toHaveBeenCalledWith("user-1", "pull");
  });

  it("ignores a channel whose resource id is no longer current", async () => {
    const { service, trigger } = setup(active);
    await service.onNotification("chan", "tok", "exists", "res-old");
    expect(trigger.enqueue).not.toHaveBeenCalled();
  });

  it("ignores a notification with a bad channel token", async () => {
    const { service, trigger } = setup(active, false);
    await service.onNotification("chan", "forged", "exists", "res-1");
    expect(trigger.enqueue).not.toHaveBeenCalled();
  });

  it("never throws, so the webhook still answers 2xx", async () => {
    const { service, trigger } = setup(active);
    trigger.enqueue.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      service.onNotification("chan", "tok", "exists", "res-1"),
    ).resolves.toBeUndefined();
  });
});
