import { BadRequestException } from "@nestjs/common";
import type { SessionWindow } from "@zenflow/shared";
import type { PlacementConstraint } from "../scheduler/types/placement.types";

const WINDOW_MINUTES = 360;

/** A DTO or row's `notBefore` / `window` as the placer's constraint. */
export const constraintOf = (x: {
  notBefore?: string | Date | null;
  window?: string | null;
}): PlacementConstraint => ({
  notBefore: x.notBefore ? new Date(x.notBefore) : null,
  window: (x.window as SessionWindow | null | undefined) ?? null,
});

/** Rejects bounds a task can never satisfy, so the corruption never reaches the row. */
export function assertTaskBounds(b: {
  notBefore?: Date | null;
  window?: string | null;
  durationMinutes: number;
  deadline: Date;
}): void {
  if (
    b.notBefore &&
    b.notBefore.getTime() + b.durationMinutes * 60_000 > b.deadline.getTime()
  ) {
    throw new BadRequestException(
      "Won't fit between the earliest start and the deadline\nPick an earlier start or a later deadline.",
    );
  }
  if (b.window && b.durationMinutes > WINDOW_MINUTES) {
    throw new BadRequestException(
      "Too long for that part of the day\nRemove the time of day or shorten it.",
    );
  }
}
