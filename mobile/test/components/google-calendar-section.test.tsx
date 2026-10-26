import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section";
import { renderScreen } from "@/test/utils/render";

describe("GoogleCalendarSection", () => {
  it("offers Connect while nothing is linked", async () => {
    renderScreen(<GoogleCalendarSection />);
    expect(await screen.findByText("Sync to Google Calendar")).toBeTruthy();
    expect(screen.getByText("Connect")).toBeTruthy();
    expect(screen.queryByTestId("google-calendar.sync")).toBeNull();
  });
});
