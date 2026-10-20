import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@zenflow/shared";

const api = vi.hoisted(() => ({
  getSessionDetails: vi.fn(),
  updateSession: vi.fn(),
  slotPick: vi.fn(),
  removeSession: vi.fn(),
}));
vi.mock("@/api/tasks", () => api);

import { offerPrepReschedule } from "../prep-toast";

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

    it("offers Keep and Prefer as two large choices that stay until taken", async () => {
      const toast = await reschedule(proposal);

      const { title, confirm, persistent } = toast.mock.calls[1][0];
      expect(title).toBe("Pick a time for your prep");
      expect(confirm.cancelLabel).toBe("Keep 7:00 AM, Tue");
      expect(confirm.confirmLabel).toBe("Prefer 3:00 PM, Mon");
      expect(persistent).toBeUndefined();
    });

    it("keeps the applied time when Keep is picked", async () => {
      const toast = await reschedule(proposal);

      toast.mock.calls[1][0].confirm.onCancel();

      await vi.waitFor(() =>
        expect(api.slotPick).toHaveBeenCalledWith("prep-1", {
          slotProposalId: "proposal-1",
          chose: "primary",
        }),
      );
    });

    it("moves the plan when Prefer is picked", async () => {
      const toast = await reschedule(proposal);

      toast.mock.calls[1][0].confirm.onConfirm();

      await vi.waitFor(() =>
        expect(api.slotPick).toHaveBeenCalledWith("prep-1", {
          slotProposalId: "proposal-1",
          chose: "alternative",
        }),
      );
    });

    it("sends nothing when the offer is dismissed, so the applied time stands", async () => {
      const toast = await reschedule(proposal);

      toast.mock.calls[1][0].confirm.onDismiss();

      expect(api.slotPick).not.toHaveBeenCalled();
    });

    it("confirms with a plain toast when there is only one time", async () => {
      const toast = await reschedule({ divergent: false });

      expect(toast.mock.calls[1][0].title).toBe("Prep plans rescheduled");
    });
  });
});
