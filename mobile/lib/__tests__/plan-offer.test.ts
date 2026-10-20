import { describe, expect, it, vi } from "vitest";
import type { NotificationDto } from "@zenflow/shared";

vi.mock("@/api/tasks", () => ({ slotPick: vi.fn() }));

import {
  choiceForAction,
  choiceForButton,
  isOpenPlanOffer,
  offerTimes,
} from "../plan-offer";

const offer = (over: Partial<NotificationDto> = {}): NotificationDto =>
  ({
    id: "n1",
    eventName: "plan_offer.prep",
    sessionId: "prep-1",
    slotProposalId: "prop-1",
    offerSlots: ["2026-10-27T10:00:00.000Z", "2026-10-28T09:00:00.000Z"],
    actionTakenAt: null,
    ...over,
  }) as NotificationDto;

describe("plan offer choices", () => {
  it("maps Keep to the scheduler's time and Prefer to the other", () => {
    expect(choiceForButton(0)).toBe("primary");
    expect(choiceForButton(1)).toBe("alternative");
  });

  it("maps the push actions the same way as the buttons", () => {
    expect(choiceForAction("keep")).toBe("primary");
    expect(choiceForAction("prefer")).toBe("alternative");
    expect(choiceForAction("reschedule")).toBeNull();
  });

  it("returns the times as keep and prefer", () => {
    expect(offerTimes(offer())).toEqual({
      primary: "2026-10-27T10:00:00.000Z",
      alternative: "2026-10-28T09:00:00.000Z",
    });
  });
});

describe("isOpenPlanOffer", () => {
  it("is true for an unanswered offer with both times", () => {
    expect(isOpenPlanOffer(offer())).toBe(true);
  });

  it("is false once answered", () => {
    expect(isOpenPlanOffer(offer({ actionTakenAt: "2026-10-20T08:00:00.000Z" }))).toBe(false);
  });

  it("is false for other notifications or a single time", () => {
    expect(isOpenPlanOffer(offer({ eventName: "assignment.created" }))).toBe(false);
    expect(isOpenPlanOffer(offer({ offerSlots: [] }))).toBe(false);
    expect(isOpenPlanOffer(offer({ slotProposalId: null }))).toBe(false);
  });
});
