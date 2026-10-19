import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type RefObject, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionDetailSheet,
  type SessionDetailSheetHandle,
} from "@/components/calendar/session-detail-sheet";
import { makeSession } from "@/test/fixtures";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";
import { waitForContent } from "@/test/utils/skeleton";

// Props of the sheet's content on its last render, so a test can move it to a snap point
// (gestures do not run under happy-dom).
const sheet = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@/components/ui/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/bottom-sheet")>();
  const { createElement, forwardRef } = await import("react");
  const BottomSheetContent = forwardRef((props: Record<string, unknown>, ref) => {
    sheet.props = props;
    return createElement(actual.BottomSheetContent, { ...props, ref } as never);
  });
  return { ...actual, BottomSheetContent };
});

// The WebView stand-in shows the document it was given, so the note is assertable.
vi.mock("react-native-webview", () => ({
  WebView: ({ source }: { source: { html: string } }) => (
    <div data-testid="session-note" data-html={source.html} />
  ),
}));

// The font loader reads an asset the component tests do not provide.
vi.mock("@/lib/geist-webview-font", () => ({
  loadGeistWebviewFontDataUri: vi.fn(async () => ""),
}));

const TZ = "Asia/Ho_Chi_Minh";

function renderSheet() {
  const ref: RefObject<SessionDetailSheetHandle | null> = createRef();
  renderScreen(<SessionDetailSheet ref={ref} tz={TZ} />);
  return ref;
}

beforeEach(() => {
  sheet.props = null;
});

describe("SessionDetailSheet", () => {
  it("shows every field as an editable input on a saved session", async () => {
    const ref = renderSheet();
    act(() =>
      ref.current?.open(
        makeSession({
          id: "a",
          title: "Algorithms lecture",
          type: "TASK",
          // 03:00Z is 10:00 in UTC+7.
          scheduledStartTime: "2026-10-15T03:00:00.000Z",
          durationMinutes: 90,
          deadline: "2026-10-20T10:00:00.000Z",
          location: "Room B201",
          tags: ["Algorithms"],
          reminders: [15],
        }),
      ),
    );
    await screen.findByTestId("session.editor");
    await waitForContent();
    expect(screen.getByDisplayValue("Algorithms lecture")).toBeTruthy();
    expect(screen.getByText("Room B201")).toBeTruthy();
    expect(screen.getByText("Algorithms")).toBeTruthy();
    expect(screen.getByTestId("session.delete")).toBeTruthy();
  });

  it("never explains why the scheduler picked the start", async () => {
    const ref = renderSheet();
    act(() =>
      ref.current?.open(
        makeSession({
          id: "a",
          scheduledStartTime: "2026-10-15T14:00:00.000Z",
          placementReason: "PREFERRED_HOUR",
        }),
      ),
    );
    await screen.findByTestId("session.editor");
    await waitForContent();
    expect(screen.queryByTestId("session-detail-reason")).toBeNull();
    expect(screen.queryByText(/you usually study then/)).toBeNull();
  });

  it("shows the note as rich text with an expand button", async () => {
    const ref = renderSheet();
    act(() =>
      ref.current?.open(makeSession({ id: "a", note: "<p>Read chapter 4</p>" })),
    );
    await screen.findByTestId("session.editor");
    await waitForContent();
    expect(screen.getByTestId("session-note").getAttribute("data-html")).toContain("Read chapter 4");
    expect(screen.getByTestId("session.note.expand")).toBeTruthy();
  });

  it("shows the empty note prompt when there is no note", async () => {
    const ref = renderSheet();
    act(() => ref.current?.open(makeSession({ id: "a", note: "<p></p>" })));
    await screen.findByTestId("session.editor");
    await waitForContent();
    expect(screen.getByText("Add notes…")).toBeTruthy();
  });

  it("opens a draft with its title and a schedule button, without a delete", async () => {
    const ref = renderSheet();
    act(() => ref.current?.openDraft({ title: "Essay draft" }));
    await screen.findByTestId("session.editor");
    await waitForContent();
    expect(screen.getByTestId("session-detail-draft").textContent).toBe("New plan");
    expect(screen.getByDisplayValue("Essay draft")).toBeTruthy();
    expect(screen.getByTestId("session.place")).toBeTruthy();
    expect(screen.queryByTestId("session.delete")).toBeNull();
  });

  it("saves the title while typing, once the typing pauses", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${API}/sessions/a`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: makeSession({ id: "a", title: "Typed" }) });
      }),
    );
    const ref = renderSheet();
    act(() => ref.current?.open(makeSession({ id: "a", title: "Algorithms lecture", type: "TASK" })));
    const input = await screen.findByTestId("session.title");
    await waitForContent();
    fireEvent.change(input, { target: { value: "Typed" } });
    expect(body).toBeNull();
    await waitFor(() => expect(body).toMatchObject({ title: "Typed" }));
    await screen.findByTestId("session.saved");
  });

  describe("prep plans", () => {
    const lecture = (iso: string) =>
      makeSession({ id: "lec", title: "Math", type: "LECTURE", scheduledStartTime: iso });
    const prep = (over = {}) =>
      makeSession({
        id: "prep-1",
        title: "Prepare for Math",
        type: "TASK",
        scheduledStartTime: "2099-01-01T01:00:00.000Z",
        completedAt: null,
        ...over,
      });
    const details = (prepSessions: unknown[]) =>
      http.get(`${API}/sessions/lec`, () =>
        HttpResponse.json({ data: { ...lecture("2099-01-01T03:00:00.000Z"), prepSessions } }),
      );

    it("hides Prepare in advance for a lecture that already started", async () => {
      server.use(details([]));
      const ref = renderSheet();
      act(() => ref.current?.open(lecture("2020-01-01T03:00:00.000Z")));
      await screen.findByTestId("session.editor");
      await waitForContent();
      expect(screen.queryByTestId("session-detail-prepare")).toBeNull();
    });

    it("offers Prepare in advance for an upcoming lecture with no plan", async () => {
      server.use(details([]));
      const ref = renderSheet();
      act(() => ref.current?.open(lecture("2099-01-01T03:00:00.000Z")));
      await screen.findByTestId("session-detail-prepare");
    });

    it("offers Prepare in advance for an upcoming assignment and exam", async () => {
      for (const type of ["ASSIGNMENT", "EXAM"] as const) {
        server.use(
          http.get(`${API}/sessions/x`, () =>
            HttpResponse.json({ data: { ...lecture("2099-01-01T03:00:00.000Z"), id: "x", type, prepSessions: [] } }),
          ),
        );
        const ref = renderSheet();
        act(() =>
          ref.current?.open(makeSession({ id: "x", title: "Essay", type, scheduledStartTime: "2099-01-01T03:00:00.000Z" })),
        );
        await screen.findByTestId("session-detail-prepare");
        cleanup();
      }
    });

    it("hides Prepare in advance once the session is skipped", async () => {
      const ref = renderSheet();
      act(() =>
        ref.current?.open(
          makeSession({ id: "x", type: "EXAM", skipped: true, scheduledStartTime: "2099-01-01T03:00:00.000Z" }),
        ),
      );
      await screen.findByTestId("session.editor");
      await waitForContent();
      expect(screen.queryByTestId("session-detail-prepare")).toBeNull();
    });

    it("shows what a plan prepares for and opens it", async () => {
      const plan = prep({ prepForSessionId: "lec" });
      server.use(
        http.get(`${API}/sessions/prep-1`, () =>
          HttpResponse.json({
            data: { ...plan, prepSessions: [], prepTarget: lecture("2099-01-01T03:00:00.000Z") },
          }),
        ),
      );
      const ref = renderSheet();
      act(() => ref.current?.open(plan));
      const card = await screen.findByTestId("session-detail-prep-target");
      expect(card.textContent).toContain("Preparing for");
      expect(card.textContent).toContain("Math");
    });

    it("puts a done checkbox in the header of a plan", async () => {
      let called = false;
      const plan = prep({ prepForSessionId: "lec" });
      server.use(
        http.get(`${API}/sessions/prep-1`, () =>
          HttpResponse.json({ data: { ...plan, prepSessions: [], prepTarget: null } }),
        ),
        http.post(`${API}/sessions/prep-1/complete`, () => {
          called = true;
          return HttpResponse.json({
            data: { session: { ...plan, completedAt: "2099-01-01T01:30:00.000Z" } },
          });
        }),
      );
      const ref = renderSheet();
      act(() => ref.current?.open(plan));
      fireEvent.click(await screen.findByTestId("session-detail-plan-check"));
      await waitFor(() => expect(called).toBe(true));
    });

    it("has no header checkbox on a plain session", async () => {
      const ref = renderSheet();
      act(() => ref.current?.open(makeSession({ id: "t", type: "TASK" })));
      await screen.findByTestId("session.editor");
      expect(screen.queryByTestId("session-detail-plan-check")).toBeNull();
    });

    it("lists the linked plan instead of the button", async () => {
      server.use(details([prep()]));
      const ref = renderSheet();
      act(() => ref.current?.open(lecture("2099-01-01T03:00:00.000Z")));
      await screen.findByTestId("session-detail-prep-prep-1");
      expect(screen.queryByTestId("session-detail-prepare")).toBeNull();
    });

    it("marks a plan done on a long press", async () => {
      let called = false;
      server.use(
        details([prep()]),
        http.post(`${API}/sessions/prep-1/complete`, () => {
          called = true;
          return HttpResponse.json({
            data: { session: prep({ completedAt: "2099-01-01T01:30:00.000Z" }) },
          });
        }),
      );
      const ref = renderSheet();
      act(() => ref.current?.open(lecture("2099-01-01T03:00:00.000Z")));
      const row = await screen.findByTestId("session-detail-prep-prep-1");
      fireEvent.mouseDown(row);
      await new Promise((resolve) => setTimeout(resolve, 450));
      fireEvent.mouseUp(row);
      await waitFor(() => expect(called).toBe(true));
    });
  });

  describe("skip", () => {
    const exam = makeSession({ id: "exam-1", title: "Final", type: "EXAM", scheduledStartTime: "2099-01-01T03:00:00.000Z" });

    it("skips a one-off exam in one tap", async () => {
      let called = false;
      server.use(
        http.get(`${API}/sessions/exam-1`, () => HttpResponse.json({ data: { ...exam, prepSessions: [] } })),
        http.post(`${API}/sessions/exam-1/skip`, () => {
          called = true;
          return HttpResponse.json({ data: { session: { ...exam, skipped: true } } });
        }),
      );
      const ref = renderSheet();
      act(() => ref.current?.open(exam));
      await screen.findByTestId("session.editor");
      await waitForContent();
      fireEvent.click(await screen.findByTestId("session-detail-skip"));
      await waitFor(() => expect(called).toBe(true));
    });

    it("undoes a skip on a timetable row without a scope", async () => {
      const skipped = makeSession({
        id: "tt-1",
        type: "LECTURE",
        source: "PORTAL",
        skipped: true,
        scheduledStartTime: "2099-01-01T03:00:00.000Z",
      });
      let url = "";
      server.use(
        http.get(`${API}/sessions/tt-1`, () => HttpResponse.json({ data: { ...skipped, prepSessions: [] } })),
        http.delete(`${API}/sessions/tt-1/skip`, ({ request }) => {
          url = request.url;
          return HttpResponse.json({ data: { session: { ...skipped, skipped: false } } });
        }),
      );
      const ref = renderSheet();
      act(() => ref.current?.open(skipped));
      await screen.findByTestId("session.editor");
      await waitForContent();
      fireEvent.click(await screen.findByTestId("session-detail-skip"));
      await waitFor(() => expect(url).toContain("/sessions/tt-1/skip"));
      expect(url).not.toContain("scope");
    });

    it("offers no skip for a task", async () => {
      const ref = renderSheet();
      act(() => ref.current?.open(makeSession({ id: "t", type: "TASK" })));
      await screen.findByTestId("session.editor");
      await waitForContent();
      expect(screen.queryByTestId("session-detail-skip")).toBeNull();
    });
  });

  describe("synced sessions", () => {
    it("shows no delete and a read-only title for a portal lecture", async () => {
      const ref = renderSheet();
      act(() =>
        ref.current?.open(
          makeSession({ id: "p", title: "Algorithms", type: "LECTURE", source: "PORTAL", scheduledStartTime: "2020-01-01T03:00:00.000Z" }),
        ),
      );
      await screen.findByTestId("session.editor");
      await waitForContent();
      expect(screen.queryByTestId("session.delete")).toBeNull();
      expect((screen.getByTestId("session.title") as HTMLInputElement).readOnly).toBe(true);
    });

    it("shows no chevron on the time the sync owns", async () => {
      const ref = renderSheet();
      act(() =>
        ref.current?.open(
          makeSession({ id: "p", type: "LECTURE", source: "PORTAL", scheduledStartTime: "2020-01-01T03:00:00.000Z" }),
        ),
      );
      await screen.findByTestId("session.editor");
      await waitForContent();
      // Only the tile icon, no chevron.
      expect(screen.getByTestId("session.when").querySelectorAll("svg")).toHaveLength(1);
    });

    it("keeps the chevron on the fields of a lecture the student made", async () => {
      const ref = renderSheet();
      act(() =>
        ref.current?.open(
          makeSession({ id: "u", type: "LECTURE", source: "USER", scheduledStartTime: "2020-01-01T03:00:00.000Z" }),
        ),
      );
      await screen.findByTestId("session.editor");
      await waitForContent();
      expect(screen.getByTestId("session.when").querySelectorAll("svg")).toHaveLength(2);
    });

    it("keeps delete for a lecture the student made", async () => {
      const ref = renderSheet();
      act(() =>
        ref.current?.open(
          makeSession({ id: "u", title: "Mine", type: "LECTURE", source: "USER", scheduledStartTime: "2020-01-01T03:00:00.000Z" }),
        ),
      );
      await screen.findByTestId("session.editor");
      await waitForContent();
      expect(screen.getByTestId("session.delete")).toBeTruthy();
    });
  });
});
