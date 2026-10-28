import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeScreen from "@/app/(app)/index";
import { useUserStore } from "@/hooks/use-user-store";
import { paletteDisk } from "@/lib/palette/palette-disk";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// The undo window is under test control: commits wait in `pending` until a test flushes them.
const pending = vi.hoisted(() => ({ list: [] as { run: () => void | Promise<void>; cancelled: boolean }[] }));
vi.mock("@/lib/undo", () => ({
  UNDO_WINDOW_MS: 5000,
  deferCommit: (run: () => void | Promise<void>) => {
    const entry = { run, cancelled: false };
    pending.list.push(entry);
    return () => {
      entry.cancelled = true;
    };
  },
}));
const flush = async () => {
  for (const e of pending.list.splice(0)) if (!e.cancelled) await e.run();
};

interface Calls {
  bulk: { dryRun?: boolean; items: Record<string, unknown>[] }[];
  put: { ifMatch: string | null; size: number }[];
  bulkDelete: unknown[];
  confirm: number;
  freeSlots: URLSearchParams[];
  recap: number;
  update: { items: { id: string; patch: Record<string, unknown> }[] }[];
}
let calls: Calls;
let bulkHandler: (body: { dryRun?: boolean; items: unknown[] }) => unknown;
const envelope = (data: unknown) => HttpResponse.json({ success: true, data });

const session = { id: "s1", title: "Toán", type: "TASK", durationMinutes: 60, scheduledStartTime: "2026-10-28T01:00:00.000Z" };
const proposed = (index: number) => ({ index, status: "PROPOSED", proposedStart: "2026-10-28T01:00:00.000Z", proposedEnd: "2026-10-28T02:00:00.000Z", timezone: "Asia/Ho_Chi_Minh", localStart: `Wed 08:00 #${index}`, warnings: [] });

beforeEach(() => {
  pending.list.length = 0;
  paletteDisk.clear();
  calls = { bulk: [], put: [], bulkDelete: [], confirm: 0, freeSlots: [], recap: 0, update: [] };
  bulkHandler = (body) => ({ dryRun: !!body.dryRun, results: body.items.map((_, i) => (body.dryRun ? proposed(i) : { index: i, status: "CREATED", id: `new${i}`, scheduledStartTime: null })) });
  useUserStore.setState({ user: testUser as never, loading: false });
  server.use(
    http.get(`${API}/users/me/palette`, () => new HttpResponse(null, { status: 204 })),
    http.put(`${API}/users/me/palette`, async ({ request }) => {
      calls.put.push({ ifMatch: request.headers.get("if-match"), size: (await request.arrayBuffer()).byteLength });
      return new HttpResponse(null, { status: 200, headers: { ETag: "1" } });
    }),
    http.get(`${API}/sessions/suggestions`, () => envelope({ suggestions: [{ id: "s1", title: "Toán cao cấp", durationMinutes: 90, location: "P201" }] })),
    http.get(`${API}/sessions/recap`, () => {
      calls.recap++;
      return envelope({ timezone: "Asia/Ho_Chi_Minh", days: [], hourHeat: [], insights: ["Light week"], deadlines: [{ title: "Lý", placed: false }], totals: { hoursByType: {}, busiestDay: null, lightestDay: null, unplacedTasks: 1 }, gaps: { daysWithoutLunchBreak: [], heavyEvenings: [], hasOvernightDnd: false } });
    }),
    http.get(`${API}/sessions/free-slots`, ({ request }) => {
      calls.freeSlots.push(new URL(request.url).searchParams);
      return envelope([]);
    }),
    http.get(`${API}/sessions`, () => envelope({ sessions: [session] })),
    http.post(`${API}/sessions/bulk-update`, async ({ request }) => {
      const body = (await request.json()) as Calls["update"][number];
      calls.update.push(body);
      return envelope({ results: body.items.map((_, index) => ({ index, status: "UPDATED" })) });
    }),
    http.post(`${API}/sessions/bulk`, async ({ request }) => {
      const body = (await request.json()) as { dryRun?: boolean; items: Record<string, unknown>[] };
      calls.bulk.push(body);
      return envelope(bulkHandler(body));
    }),
    http.post(`${API}/sessions/bulk-delete`, async ({ request }) => {
      calls.bulkDelete.push(await request.json());
      return envelope({ dryRun: false, results: [] });
    }),
    http.post(`${API}/sessions/replan`, () => envelope({ moves: [], unchanged: 2, unplaced: [{ id: "x", title: "Lý" }] })),
    http.post(`${API}/sessions/replan/confirm`, () => {
      calls.confirm++;
      return envelope({ moves: [], unchanged: 2, unplaced: [], undoGroupId: null });
    }),
  );
});

const input = () => screen.getByTestId("palette-input") as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const send = () => fireEvent.click(screen.getByTestId("palette-send"));
const confirm = async () => fireEvent.click(await screen.findByTestId("footer-primary"));
const created = () => calls.bulk.filter((b) => !b.dryRun);

describe("HomeScreen", () => {
  it("does not crash without a signed-in user", async () => {
    useUserStore.setState({ user: null, loading: false });
    renderScreen(<HomeScreen />);
    type("toán");
    expect(input().value).toBe("toán");
  });

  it("learns from existing sessions on a first launch and pushes the backup with If-Match 0", async () => {
    renderScreen(<HomeScreen />);
    await waitFor(() => expect(calls.put).toHaveLength(1));
    expect(calls.put[0].ifMatch).toBe("0");
  });

  it("keeps working when the backup is unreachable", async () => {
    server.use(http.get(`${API}/users/me/palette`, () => HttpResponse.error()));
    renderScreen(<HomeScreen />);
    type("toán");
    expect(input().value).toBe("toán");
  });

  describe("add", () => {
    it("previews on Send, adds on confirm after the undo window, with the learned default length", async () => {
      renderScreen(<HomeScreen />);
      type("toán");
      send();
      await confirm();
      expect(created()).toHaveLength(0);
      await flush();
      await waitFor(() => expect(created()).toHaveLength(1));
      expect(created()[0].items[0]).toMatchObject({ type: "TASK", title: "toán", durationMinutes: 60 });
    });

    it("undo puts the text back and sends nothing", async () => {
      renderScreen(<HomeScreen />);
      type("toán");
      send();
      await confirm();
      fireEvent.click(await screen.findByText("Undo"));
      expect(input().value).toBe("toán");
      await flush();
      expect(created()).toHaveLength(0);
    });

    it("a length typed anywhere is read and leaves the title", async () => {
      renderScreen(<HomeScreen />);
      type("2h toán");
      send();
      await confirm();
      await flush();
      await waitFor(() => expect(created()).toHaveLength(1));
      expect(created()[0].items[0]).toMatchObject({ title: "toán", durationMinutes: 120 });
    });

    it("a bare number is never offered as a chip", () => {
      renderScreen(<HomeScreen />);
      type("thứ 6");
      expect(input().value).toBe("thứ 6");
    });

    it("a new line is its own task and takes nothing from the line above", async () => {
      renderScreen(<HomeScreen />);
      type("toán 90m\nlý");
      send();
      await confirm();
      await flush();
      await waitFor(() => expect(created()).toHaveLength(1));
      expect(created()[0].items.map((i) => i.durationMinutes)).toEqual([90, 60]);
    });

    it("reports items that failed", async () => {
      bulkHandler = (body) =>
        body.dryRun
          ? { dryRun: true, results: body.items.map((_, i) => proposed(i)) }
          : { dryRun: false, results: [{ index: 0, status: "CREATED", id: "a", scheduledStartTime: null }, { index: 1, status: "ERROR", code: "X", message: "m" }] };
      renderScreen(<HomeScreen />);
      type("toán\nlý");
      send();
      await confirm();
      await flush();
      expect(await screen.findByText("1 not added")).toBeTruthy();
    });

    it("offers a time choice when two placements differ", async () => {
      bulkHandler = (body) =>
        body.dryRun
          ? { dryRun: true, results: body.items.map((_, i) => proposed(i)) }
          : { dryRun: false, results: [{ index: 0, status: "CREATED", id: "a", scheduledStartTime: null, pairwise: { slotProposalId: "p1", primary: "2026-10-28T01:00:00.000Z", alternative: "2026-10-28T05:00:00.000Z" } }] };
      renderScreen(<HomeScreen />);
      type("toán");
      send();
      await confirm();
      await flush();
      expect(await screen.findByText("Which time suits you better?")).toBeTruthy();
    });

    it("learns a created title", async () => {
      renderScreen(<HomeScreen />);
      await waitFor(() => expect(paletteDisk.load("u1").titles["toán cao cấp"]).toBeTruthy());
      type("zzz");
      send();
      await confirm();
      await flush();
      await waitFor(() => expect(paletteDisk.load("u1").titles.zzz?.count).toBe(1));
    });
  });

  describe("edit", () => {
    const pickToan = async () => {
      renderScreen(<HomeScreen />);
      type("edit @");
      fireEvent.click(await screen.findByTestId("mention-s1"));
    };

    const moveDay = async () => {
      fireEvent.click(await screen.findByTestId("field-move"));
      fireEvent.click(await screen.findByTestId("move-plus-day"));
      send();
    };

    it("pick a task, pick a change, and it applies after the undo window", async () => {
      await pickToan();
      await moveDay();
      expect(calls.update).toHaveLength(0);
      await flush();
      await waitFor(() => expect(calls.update).toHaveLength(1));
      expect(calls.update[0].items[0].id).toBe("s1");
      expect(calls.update[0].items[0].patch).toHaveProperty("scheduledStartTime");
    });

    it("undo sends nothing", async () => {
      await pickToan();
      await moveDay();
      fireEvent.click(await screen.findByText("Undo"));
      await flush();
      expect(calls.update).toHaveLength(0);
    });

    it("All matching picks every match", async () => {
      server.use(http.get(`${API}/sessions`, () => envelope({ sessions: [session, { ...session, id: "s2", title: "Toán 2" }] })));
      renderScreen(<HomeScreen />);
      type("edit @toán");
      fireEvent.click(await screen.findByTestId("mention-all"));
      await moveDay();
      await flush();
      await waitFor(() => expect(calls.update[0]?.items.map((i) => i.id)).toEqual(["s1", "s2"]));
    });
  });

  describe("verbs", () => {
    it("recap runs once a range is picked", async () => {
      renderScreen(<HomeScreen />);
      type("recap");
      fireEvent.click(await screen.findByTestId("range-this_week"));
      await waitFor(() => expect(calls.recap).toBeGreaterThan(0));
    });

    it("a failing recap shows the failed view and keeps the field", async () => {
      server.use(http.get(`${API}/sessions/recap`, () => HttpResponse.json({ message: "x" }, { status: 500 })));
      renderScreen(<HomeScreen />);
      type("recap");
      fireEvent.click(await screen.findByTestId("range-this_week"));
      expect(await screen.findByTestId("failed-view")).toBeTruthy();
      expect(screen.getByTestId("palette-badge").textContent).toBe("Recap");
    });

    it("free asks for a length first", async () => {
      renderScreen(<HomeScreen />);
      type("free");
      fireEvent.click(await screen.findByTestId("duration-90"));
      fireEvent.click(await screen.findByTestId("range-this_week"));
      await waitFor(() => expect(calls.freeSlots.some((p) => p.get("durationMinutes") === "90")).toBe(true));
    });

    it("delete sends after the undo window", async () => {
      renderScreen(<HomeScreen />);
      type("delete @");
      fireEvent.click(await screen.findByTestId("mention-s1"));
      send();
      await flush();
      await waitFor(() => expect(calls.bulkDelete).toEqual([{ items: [{ kind: "session", id: "s1" }] }]));
    });
  });
});
