import { Injectable } from "@nestjs/common";
import type { PlaceableTask } from "../types/placement.types";
import { HeuristicPlacer } from "./heuristic-placer.service";

/**
 * FROZEN FALLBACK (ADR-0003): bug fixes only; behaviour changes belong in
 * services/bandit.
 *
 * The degraded-mode driver used when the Python `/v1/place` is unavailable
 * (timeout, breaker open, disabled, contract mismatch): the pre-#62 heuristic
 * only - overlap-weighted preference-matrix best-free-slot via
 * {@link HeuristicPlacer} and the frozen `core/slot.ts` / `slot-score.ts` /
 * `preference.ts` / `series-spread.ts`. It never displaces tasks, never
 * accepts conflicts, and never rolls the A/B policy. A miss is treated like a
 * Python `INFEASIBLE` (never a 503).
 */
@Injectable()
export class FallbackPlacer {
  constructor(private readonly heuristic: HeuristicPlacer) {}

  /** Best free slot for one `TASK` (`null` = nothing free before the deadline). */
  placeSingle(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
  ): Promise<Date | null> {
    return this.heuristic.placeTask(
      userId,
      task,
      timezone,
      preferenceMatrix,
      now,
      [],
      task.constraint,
    );
  }
}
