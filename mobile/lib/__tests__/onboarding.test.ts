import { describe, expect, it } from "vitest";
import {
  canGoBack,
  filterTimezones,
  nextStep,
  pendingSetupItems,
  prevStep,
  routeForSession,
  utcOffsetMinutes,
} from "../onboarding";

describe("routeForSession", () => {
  it("sends signed-out users to login", () => {
    expect(routeForSession(null, "(app)")).toBe("/(auth)/login");
    expect(routeForSession(null, "(auth)")).toBeNull();
  });
  it("routes un-onboarded users to onboarding", () => {
    const u = { onboardedAt: null };
    expect(routeForSession(u, "(auth)")).toBe("/(onboarding)");
    expect(routeForSession(u, "(app)")).toBe("/(onboarding)");
    expect(routeForSession(u, "(onboarding)")).toBeNull();
  });
  it("leaves existing users alone and bounces them out of onboarding/auth", () => {
    const u = { onboardedAt: "2026-01-01T00:00:00.000Z" };
    expect(routeForSession(u, "(app)")).toBeNull();
    expect(routeForSession(u, "(auth)")).toBe("/(app)/settings");
    expect(routeForSession(u, "(onboarding)")).toBe("/(app)/settings");
  });
});

describe("step navigation", () => {
  it("walks forward and clamps", () => {
    expect(nextStep("dlu")).toBe("notifications");
    expect(nextStep("notifications")).toBe("assistants");
    expect(nextStep("assistants")).toBe("done");
    expect(nextStep("done")).toBe("done");
  });
  it("walks back and clamps; no back on first/done", () => {
    expect(prevStep("dlu")).toBe("dlu");
    expect(canGoBack("dlu")).toBe(false);
    expect(canGoBack("done")).toBe(false);
  });
});


describe("pendingSetupItems", () => {
  it("derives from real state", () => {
    expect(
      pendingSetupItems({ notificationsActive: true, dluConnected: true }),
    ).toEqual([]);
    expect(
      pendingSetupItems({ notificationsActive: false, dluConnected: false }),
    ).toEqual(["notifications", "dlu"]);
  });
});

describe("filterTimezones", () => {
  const zones = ["Asia/Singapore", "Asia/Ho_Chi_Minh", "Europe/Paris"];
  it("filters", () => {
    expect(filterTimezones(zones, "sing")).toEqual(["Asia/Singapore"]);
    expect(filterTimezones(zones, "ho chi")).toEqual(["Asia/Ho_Chi_Minh"]);
    expect(filterTimezones(zones, "")).toEqual(zones);
  });
  it("orders by proximity to the detected zone, not alphabetically", () => {
    const all = [
      "America/New_York",
      "Asia/Bangkok",
      "Asia/Tokyo",
      "Asia/Ho_Chi_Minh",
      "Australia/Perth",
      "Europe/Paris",
      "Asia/Jakarta",
    ];
    const out = filterTimezones(all, "", 50, "Asia/Ho_Chi_Minh");
    expect(out).not.toContain("Asia/Ho_Chi_Minh");
    // Same +7 offset first (same-region, then name), then nearer offsets.
    expect(out.slice(0, 2)).toEqual(["Asia/Bangkok", "Asia/Jakarta"]);
    expect(out.indexOf("Australia/Perth")).toBeLessThan(out.indexOf("Asia/Tokyo"));
    expect(out.indexOf("Asia/Tokyo")).toBeLessThan(out.indexOf("Europe/Paris"));
    expect(out.indexOf("Europe/Paris")).toBeLessThan(
      out.indexOf("America/New_York"),
    );
  });
  it("keeps the detected zone when searching", () => {
    expect(filterTimezones(["Asia/Ho_Chi_Minh", "Asia/Bangkok"], "asia", 50, "Asia/Ho_Chi_Minh")[0]).toBe("Asia/Bangkok");
  });
});


describe("utcOffsetMinutes", () => {
  const jan = new Date("2025-01-15T12:00:00Z");
  it("returns real offsets, not 0 for everything", () => {
    expect(utcOffsetMinutes("Asia/Ho_Chi_Minh", jan)).toBe(420);
    expect(utcOffsetMinutes("Asia/Kolkata", jan)).toBe(330);
    expect(utcOffsetMinutes("America/New_York", jan)).toBe(-300);
    expect(utcOffsetMinutes("UTC", jan)).toBe(0);
  });
});
