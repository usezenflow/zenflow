import type { BulkCreateItemResult, CreateSessionInput } from "@zenflow/shared";

/** Pairs closer than this are never offered (the backend already skips them). */
export const MIN_PAIR_GAP_MINUTES = 60;
export const MAX_PAIR_OFFERS = 3;

export interface PairOffer {
  id: string;
  title: string;
  proposalId: string;
  primary: string;
  alternative: string;
  minutes: number;
}

const gap = (o: { primary: string; alternative: string }) =>
  Math.abs(Date.parse(o.alternative) - Date.parse(o.primary));

/** Created items the scheduler could place two ways, most divergent first, at most three. */
export function pairOffers(
  results: BulkCreateItemResult[],
  items: CreateSessionInput[],
): PairOffer[] {
  const offers: PairOffer[] = [];
  for (const r of results) {
    if (r.status !== "CREATED" || !r.pairwise) continue;
    const { slotProposalId, primary, alternative } = r.pairwise;
    const o = {
      id: r.id,
      title: items[r.index]?.title ?? "",
      proposalId: slotProposalId,
      primary,
      alternative,
      minutes: items[r.index]?.durationMinutes ?? 60,
    };
    if (gap(o) >= MIN_PAIR_GAP_MINUTES * 60_000) offers.push(o);
  }
  return offers.sort((a, b) => gap(b) - gap(a)).slice(0, MAX_PAIR_OFFERS);
}
