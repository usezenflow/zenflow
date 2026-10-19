/** A student whose timetable walk could be scheduled, with their confirmed sections. */
export interface WalkerCandidate {
  userId: string;
  sectionIds: readonly string[];
}

/**
 * Order candidates so each walk warms the most students' stale sections first.
 *
 * Greedy and weighted: a section's weight is how many candidates hold it, and a
 * candidate's score is the summed weight of the stale sections it still warms.
 * The top scorer is taken, its sections counted warm, and the scores recomputed.
 * Ties keep input order, so the caller's order is the rotation policy.
 *
 * Candidates left with no stale section keep their input order after the walkers.
 */
export function planWalkers(
  candidates: readonly WalkerCandidate[],
  staleSections: ReadonlySet<string>,
): string[] {
  const weight = new Map<string, number>();
  for (const { sectionIds } of candidates) {
    for (const id of new Set(sectionIds)) {
      weight.set(id, (weight.get(id) ?? 0) + 1);
    }
  }

  const cold = new Set(staleSections);
  const pool = [...candidates];
  const order: string[] = [];
  for (;;) {
    let best = -1;
    let bestScore = 0;
    pool.forEach(({ sectionIds }, index) => {
      let score = 0;
      for (const id of new Set(sectionIds)) {
        if (cold.has(id)) score += weight.get(id) ?? 0;
      }
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best < 0) break;

    const [walker] = pool.splice(best, 1);
    order.push(walker.userId);
    for (const id of walker.sectionIds) cold.delete(id);
  }
  return [...order, ...pool.map(({ userId }) => userId)];
}
