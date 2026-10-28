import type { NotificationDto } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { latestInstant, unseenNotifications } from "../background-notify-core";

const row = (id: string, sentAt: string, readAt: string | null = null) =>
  ({ id, sentAt, readAt }) as NotificationDto;

describe("unseenNotifications", () => {
  const items = [
    row("new", "2026-10-28T10:00:00.000Z"),
    row("read", "2026-10-28T09:30:00.000Z", "2026-10-28T09:40:00.000Z"),
    row("old", "2026-10-28T08:00:00.000Z"),
  ];

  it("seeds without notifying when there is no baseline", () => {
    expect(unseenNotifications(items, null)).toEqual([]);
  });

  it("returns only unread rows newer than the baseline", () => {
    const got = unseenNotifications(items, "2026-10-28T09:00:00.000Z");
    expect(got.map((n) => n.id)).toEqual(["new"]);
  });

  it("does not repeat a row at the baseline", () => {
    expect(unseenNotifications(items, "2026-10-28T10:00:00.000Z")).toEqual([]);
  });
});

describe("latestInstant", () => {
  it("keeps the newer instant", () => {
    expect(latestInstant("2026-10-28T10:00:00.000Z", null)).toBe(
      "2026-10-28T10:00:00.000Z",
    );
    expect(
      latestInstant("2026-10-28T10:00:00.000Z", "2026-10-28T11:00:00.000Z"),
    ).toBe("2026-10-28T11:00:00.000Z");
    expect(
      latestInstant("2026-10-28T10:00:00.000Z", "2026-10-28T09:00:00.000Z"),
    ).toBe("2026-10-28T10:00:00.000Z");
  });
});
