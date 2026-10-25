import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceCalendarSection } from "@/components/settings/device-calendar-section";
import { useDeviceCalendar } from "@/hooks/use-device-calendar";
import { useUserStore } from "@/hooks/use-user-store";
import { expoCalendarAdapter } from "@/lib/device-calendar/expo-adapter";
import { EMPTY_STATE } from "@/lib/device-calendar/sync";
import { testUser } from "@/test/msw/handlers";
import { renderScreen } from "@/test/utils/render";

vi.mock("@/lib/device-calendar/supported", () => ({ deviceCalendarSupported: () => true }));

beforeEach(() => {
  vi.restoreAllMocks();
  useUserStore.setState({ user: { ...testUser, lang: "en", timezone: "UTC" } as never, loading: false });
  useDeviceCalendar.setState({ state: { ...EMPTY_STATE }, syncing: false });
});

describe("DeviceCalendarSection", () => {
  it("starts off, with no sync controls", () => {
    renderScreen(<DeviceCalendarSection />);

    expect(screen.getByText("Show in my calendar app")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("device-calendar.sync")).toBeNull();
  });

  it("turns on after the phone grants access", async () => {
    vi.spyOn(expoCalendarAdapter, "requestPermission").mockResolvedValue(true);
    const sync = vi.spyOn(useDeviceCalendar.getState(), "syncNow").mockResolvedValue();
    renderScreen(<DeviceCalendarSection />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(useDeviceCalendar.getState().state.enabled).toBe(true));
    expect(sync).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId("device-calendar.sync")).toBeTruthy();
  });

  it("stays off and says so when access is refused", async () => {
    vi.spyOn(expoCalendarAdapter, "requestPermission").mockResolvedValue(false);
    renderScreen(<DeviceCalendarSection />);

    fireEvent.click(screen.getByRole("switch"));

    expect(await screen.findByText("Calendar access is off")).toBeTruthy();
    expect(useDeviceCalendar.getState().state.enabled).toBe(false);
  });
});
