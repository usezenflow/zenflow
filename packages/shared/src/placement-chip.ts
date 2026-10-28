/**
 * Why a placed TASK sits where it does, shown as chips. Tier 1 is true from the
 * geometry alone. Tier 2 needs enough Done evidence and a clear bucket. Tier 3
 * is the cold start: copy that asks the user to move the block, plus progress.
 */
export type PlacementReasonTier = 1 | 2 | 3;

export interface PlacementChip {
  tier: PlacementReasonTier;
  text: string;
}
