import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@zenflow/shared";

const api = vi.hoisted(() => ({
  getSessionDetails: vi.fn(),
  updateSession: vi.fn(),
  slotPick: vi.fn(),
  removeSession: vi.fn(),
}));
vi.mock("@/api/tasks", () => api);

import { offerPrepAfterSkip, offerPrepReschedule } from "../prep-toast";

const NEW_START = "2026-10-20T09:00:00.000Z";
const prep = (over: Partial<Session> = {}) =>
  ({
    id: "prep-1",
    completedAt: null,
    skipped: false,
    deadline: "2026-10-19T09:00:00.000Z",
    ...over,
  }) as Session;

describe("offerPrepReschedule", () => {
  beforeEach(() => {
    api.getSessionDetails.mockReset();
    api.updateSession.mockReset().mockResolvedValue({});
    api.slotPick.mockReset().mockResolvedValue({});
    api.removeSession.mockReset().mockResolvedValue({});
  });

  it("stays quiet for anything but a lecture", async () => {
    const toast = vi.fn();
    await offerPrepReschedule(toast, { id: "e", type: "EXAM" }, NEW_START, "UTC");
    expect(api.getSessionDetails).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("stays quiet when no open prep is linked", async () => {
    api.getSessionDetails.mockResolvedValue({
      prepSessions: [prep({ completedAt: "2026-10-19T08:00:00.000Z" })],
    });
    const toast = vi.fn();
    await offerPrepReschedule(toast, { id: "l", type: "LECTURE" }, NEW_START, "UTC");
    expect(toast).not.toHaveBeenCalled();
  });

  it("offers to move open preps to the new lecture start", async () => {
    api.getSessionDetails.mockResolvedValue({ prepSessions: [prep()] });
    const toast = vi.fn();
    await offerPrepReschedule(toast, { id: "l", type: "LECTURE" }, NEW_START, "UTC");

    const { title, action } = toast.mock.calls[0][0];
    expect(title).toBe("Reschedule prep plans?");
    action.onPress();
    await vi.waitFor(() =>
      expect(api.updateSession).toHaveBeenCalledWith("prep-1", {
        deadline: NEW_START,
      }),
    );
  });

  describe("two time options", () => {
    const proposal = {
      divergent: true,
      slotProposalId: "proposal-1",
      primarySlot: "2026-10-20T07:00:00.000Z",
      alternativeSlot: "2026-10-19T15:00:00.000Z",
      title: "Prepare for Math",
    };

    async function reschedule(update: Record<string, unknown>) {
      api.getSessionDetails.mockResolvedValue({ prepSessions: [prep()] });
      api.updateSession.mockResolvedValue({ id: "prep-1", ...update });
      const toast = vi.fn();
      await offerPrepReschedule(toast, { id: "l", type: "LECTURE" }, NEW_START, "UTC");
      toast.mock.calls[0][0].action.onPress();
      await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      return toast;
    }

    it("shows both times as equal buttons when the scheduler has two", async () => {
      const toast = await reschedule(proposal);

      const { title, actions } = toast.mock.calls[1][0];
      expect(title).toBe("Pick a time for your prep");
      expect(actions).toHaveLength(2);
      const labels = actions.map((a: { label: string }) => a.label);
      expect(labels.filter((l: string) => l.includes("Oct 20"))).toHaveLength(1);
      expect(labels.filter((l: string) => l.includes("Oct 19"))).toHaveLength(1);
    });

    it("keeps the applied time when its button is picked", async () => {
      const toast = await reschedule(proposal);
      const keep = toast.mock.calls[1][0].actions.find((a: { label: string }) =>
        a.label.includes("Oct 20"),
      );

      keep.onPress();

      await vi.waitFor(() =>
        expect(api.slotPick).toHaveBeenCalledWith("prep-1", {
          slotProposalId: "proposal-1",
          chose: "primary",
        }),
      );
    });

    it("moves the plan when the other button is picked", async () => {
      const toast = await reschedule(proposal);
      const swap = toast.mock.calls[1][0].actions.find((a: { label: string }) =>
        a.label.includes("Oct 19"),
      );

      swap.onPress();

      await vi.waitFor(() =>
        expect(api.slotPick).toHaveBeenCalledWith("prep-1", {
          slotProposalId: "proposal-1",
          chose: "alternative",
        }),
      );
    });

    it("confirms with a plain toast when there is only one time", async () => {
      const toast = await reschedule({ divergent: false });

      expect(toast.mock.calls[1][0].title).toBe("Prep plans rescheduled");
    });
  });
});

describe("offerPrepAfterSkip", () => {
  const NEXT = "2026-10-27T09:00:00.000Z";
  const detail = (over: Record<string, unknown> = {}) => ({
    prepSessions: [prep()],
    nextPrepOccurrenceStart: NEXT,
    ...over,
  });

  beforeEach(() => {
    api.getSessionDetails.mockReset();
    api.updateSession.mockReset().mockResolvedValue({});
    api.removeSession.mockReset().mockResolvedValue({});
  });

  it("stays quiet when no plan is open", async () => {
    api.getSessionDetails.mockResolvedValue(
      detail({ prepSessions: [prep({ completedAt: "2026-10-19T08:00:00.000Z" })] }),
    );
    const toast = vi.fn();
    await offerPrepAfterSkip(toast, { id: "l" }, "UTC");
    expect(toast).not.toHaveBeenCalled();
  });

  it("offers delete and the next class, and keeps the plan if ignored", async () => {
    api.getSessionDetails.mockResolvedValue(detail());
    const toast = vi.fn();
    await offerPrepAfterSkip(toast, { id: "l" }, "UTC");

    const { actions } = toast.mock.calls[0][0];
    expect(actions.map((a: { label: string }) => a.label)).toEqual(["Delete plan", "Next class"]);
    expect(api.removeSession).not.toHaveBeenCalled();
    expect(api.updateSession).not.toHaveBeenCalled();
  });

  it("hides the next class when there is none", async () => {
    api.getSessionDetails.mockResolvedValue(detail({ nextPrepOccurrenceStart: null }));
    const toast = vi.fn();
    await offerPrepAfterSkip(toast, { id: "l" }, "UTC");

    const { actions } = toast.mock.calls[0][0];
    expect(actions.map((a: { label: string }) => a.label)).toEqual(["Delete plan"]);
  });

  it("deletes the open plans", async () => {
    api.getSessionDetails.mockResolvedValue(detail());
    const toast = vi.fn();
    await offerPrepAfterSkip(toast, { id: "l" }, "UTC");

    toast.mock.calls[0][0].actions[0].onPress();

    await vi.waitFor(() => expect(api.removeSession).toHaveBeenCalledWith("prep-1"));
  });

  it("moves the plan to the next class", async () => {
    api.getSessionDetails.mockResolvedValue(detail());
    const toast = vi.fn();
    await offerPrepAfterSkip(toast, { id: "l" }, "UTC");

    toast.mock.calls[0][0].actions[1].onPress();

    await vi.waitFor(() =>
      expect(api.updateSession).toHaveBeenCalledWith("prep-1", {
        deadline: NEXT,
        prepForOccurrenceStart: NEXT,
      }),
    );
  });
});
