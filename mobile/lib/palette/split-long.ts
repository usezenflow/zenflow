import { MAX_SPLIT_CHUNKS, MAX_TASK_MINUTES } from "@zenflow/shared";

export interface Chunk {
  title: string;
  durationMinutes: number;
  notBefore: Date;
  deadline: Date;
}

/** Equal chunks, remainder on the later ones, in 60 minute steps for whole hours else 15. */
export function chunkMinutes(total: number, parts = 0): number[] {
  // Asked-for parts never make a chunk over the cap or under 15 minutes.
  const n = Math.max(
    Math.ceil(total / MAX_TASK_MINUTES),
    Math.min(parts, Math.floor(total / 15)),
  );
  const step = total % 60 === 0 ? 60 : 15;
  const units = total / step;
  const base = Math.floor(units / n);
  const extra = units - base * n;
  return Array.from(
    { length: n },
    (_, i) => (base + (i >= n - extra ? 1 : 0)) * step,
  );
}

/**
 * Splits a task longer than `MAX_TASK_MINUTES` into flexible chunks, each with its own
 * sub-window of `[notBefore ?? now, deadline]`. Null when over `MAX_SPLIT_CHUNKS` or the
 * window is too short for the chunks (the caller shows "Deadline too close").
 */
export function splitLong(
  task: {
    title: string;
    durationMinutes: number;
    deadline: Date;
    notBefore?: Date | null;
  },
  now: Date,
  parts = 0,
): Chunk[] | null {
  const sizes = chunkMinutes(task.durationMinutes, parts);
  if (sizes.length < 2 || sizes.length > MAX_SPLIT_CHUNKS) return null;
  const from = (task.notBefore ?? now).getTime();
  const span = (task.deadline.getTime() - from) / sizes.length;
  const chunks = sizes.map((m, i) => ({
    title: `${task.title} ${i + 1}/${sizes.length}`,
    durationMinutes: m,
    notBefore: new Date(from + span * i),
    deadline: new Date(
      i === sizes.length - 1 ? task.deadline.getTime() : from + span * (i + 1),
    ),
  }));
  return chunks.every(
    (c) =>
      c.notBefore.getTime() + c.durationMinutes * 60_000 <=
      c.deadline.getTime(),
  )
    ? chunks
    : null;
}
