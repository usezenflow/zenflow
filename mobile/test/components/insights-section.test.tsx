import { fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { InsightsSection } from "@/components/calendar/insights-section";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const EMPTY_RECAP = { plannedMinutes: 90, doneMinutes: 60, notThisTimeCount: 1, onTimeCount: 2 };

function insightsWith(body: Record<string, unknown>) {
  return http.get(`${API}/users/me/insights`, () =>
    HttpResponse.json({
      data: { window: { from: "2026-10-17", to: "2026-10-23" }, recap: EMPTY_RECAP, focus: [], buffers: [], ...body },
    }),
  );
}

beforeEach(() => {
  useUserStore.setState({
    user: { ...testUser, lang: "en", timezone: "Asia/Ho_Chi_Minh" } as never,
    loading: false,
  });
});

describe("InsightsSection", () => {
  it("keeps the stats closed until the trigger opens the sheet", async () => {
    renderScreen(<InsightsSection />);
    expect(screen.queryByText("Last 7 days")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(await screen.findByText("Last 7 days")).toBeTruthy();
  });

  it("shows the focus line below five done sessions, then the map", async () => {
    server.use(insightsWith({ focus: [{ weekday: 0, hour: 9, done: 4 }] }));
    renderScreen(<InsightsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(await screen.findByText("Your focus map fills in as you finish sessions")).toBeTruthy();
    expect(screen.queryByTestId("insights.focus-map")).toBeNull();
    expect(screen.getByText("1 h")).toBeTruthy();
  });

  it("draws the focus map once five sessions are done", async () => {
    server.use(insightsWith({ focus: [{ weekday: 2, hour: 14, done: 5 }] }));
    renderScreen(<InsightsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(await screen.findByTestId("insights.focus-map")).toBeTruthy();
  });

  it("labels prep buffers and reads nothing planned", async () => {
    server.use(
      insightsWith({
        buffers: [
          { sessionId: "e1", title: "Organic chemistry exam", type: "EXAM", dueAt: "2026-10-30T02:00:00.000Z", bufferDays: 3 },
          { sessionId: "a1", title: "Lab report", type: "ASSIGNMENT", dueAt: "2026-10-31T02:00:00.000Z", bufferDays: null },
        ],
      }),
    );
    renderScreen(<InsightsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(await screen.findByText("Prep ready, 3 days")).toBeTruthy();
    expect(screen.getByText("Nothing planned yet")).toBeTruthy();
  });
});
