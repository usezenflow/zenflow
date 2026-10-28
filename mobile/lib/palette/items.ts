import type {
  BulkCreateItemResult,
  CreateSessionInput,
  SessionType,
  SessionWindow,
} from "@zenflow/shared";
import { MAX_BULK_SESSIONS, MAX_TASK_MINUTES } from "@zenflow/shared";
import { DEFAULT_MINUTES } from "./vocab";
import { splitLong } from "./split-long";

/** One typed line plus whatever the model read from it; every hint is optional. */
export interface Line {
  title: string;
  type?: SessionType;
  minutes?: number;
  deadline?: Date;
  notBefore?: Date;
  window?: SessionWindow;
  location?: string;
  start?: Date;
  /** RFC 5545 rule of a fixed series (type DND with a start). */
  rrule?: string;
  /** One due date per occurrence of a repeating flexible task. */
  repeatDeadlines?: Date[];
  /** Cut the task into this many blocks. */
  parts?: number;
}

export interface Items {
  items: CreateSessionInput[];
  /** Index of the line each item came from; a split task owns several. */
  owner: number[];
}

/** Deadline of a task with none stated. */
export const DEFAULT_DEADLINE_DAYS = 7;
/** Longest task a line may ask for: three chunks at the cap. */
export const MAX_LINE_MINUTES = 3 * MAX_TASK_MINUTES;

/**
 * Items to send. A bare title is a complete task: learned or default length, deadline a week out.
 * A task over the cap becomes flexible chunks. Null when a split cannot fit its window.
 */
export function buildItems(
  lines: Line[],
  now: Date,
  median: (title: string) => number | undefined = () => undefined,
): Items | null {
  const items: CreateSessionInput[] = [];
  const owner: number[] = [];
  for (const [i, l] of lines.entries()) {
    const type = l.type ?? "TASK";
    const minutes = l.minutes ?? median(l.title) ?? DEFAULT_MINUTES[type];
    if (type !== "TASK") {
      const start = l.start;
      if (!start) return null;
      items.push({
        type,
        title: l.title,
        durationMinutes: minutes,
        scheduledStartTime: start.toISOString(),
        ...(l.location ? { location: l.location } : {}),
        ...(l.rrule ? { rrule: l.rrule } : {}),
      } as CreateSessionInput);
      owner.push(i);
      continue;
    }
    const ends = l.repeatDeadlines?.length
      ? l.repeatDeadlines
      : [
          l.deadline ??
            new Date(now.getTime() + DEFAULT_DEADLINE_DAYS * 86_400_000),
        ];
    for (const deadline of ends) {
      const base = {
        type,
        title: l.title,
        deadline: deadline.toISOString(),
        ...(l.window ? { window: l.window } : {}),
        ...(l.location ? { location: l.location } : {}),
      } as const;
      if (minutes > MAX_TASK_MINUTES || (l.parts ?? 0) >= 2) {
        const chunks = splitLong(
          {
            title: l.title,
            durationMinutes: minutes,
            deadline,
            notBefore: l.notBefore,
          },
          now,
          l.parts,
        );
        if (!chunks) return null;
        for (const c of chunks) {
          items.push({
            ...base,
            title: c.title,
            durationMinutes: c.durationMinutes,
            notBefore: c.notBefore.toISOString(),
            deadline: c.deadline.toISOString(),
          });
          owner.push(i);
        }
      } else {
        items.push({
          ...base,
          durationMinutes: minutes,
          ...(l.notBefore ? { notBefore: l.notBefore.toISOString() } : {}),
        });
        owner.push(i);
      }
    }
  }
  if (items.length > MAX_BULK_SESSIONS) return null;
  return items.length ? { items, owner } : null;
}

/** The results that belong to line `i`. */
export const resultsFor = (
  results: BulkCreateItemResult[] | null,
  owner: number[],
  i: number,
) => (results ?? []).filter((r) => owner[r.index] === i);

/** Lines with at least one created item, so a failed line is not learned from. */
export const createdLines = (
  results: BulkCreateItemResult[],
  owner: number[],
): Set<number> =>
  new Set(
    results.filter((r) => r.status === "CREATED").map((r) => owner[r.index]),
  );
