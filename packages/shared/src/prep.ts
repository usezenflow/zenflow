/**
 * Internal wire contract between the NestJS backend and the Python bandit
 * service's `POST /v1/prep/size` (level-up plan, Phase 1). JSON, camelCase,
 * epoch-ms integers for instants. The Pydantic models in
 * `services/bandit/src/schemas_prep.py` mirror these types.
 */

export type PrepKind = "EXAM" | "ASSIGNMENT";

/** One graded course. `letter` is the DLU grade as stored, `credits` its weight. */
export interface PrepMarkWire {
  letter: string | null;
  credits: number;
}

export interface PrepSizeRequest {
  kind: PrepKind;
  nowMs: number;
  deadlineMs: number;
  marks: PrepMarkWire[];
  avgGpa4: number | null;
}

export interface PrepSizeResponse {
  /** 0 strong record, 1 failing record. */
  weak: number;
  /** Positive multiple of 15. */
  durationMinutes: number;
  /** Earliest start, passed to placement as its `nowMs`. */
  windowStartMs: number;
  deadlineMs: number;
  /** False when the plan cannot fit before the deadline. */
  feasible: boolean;
}
