import { createHmac } from "node:crypto";
import { RARITY_WEIGHT, SPIRITS, type Spirit } from "@zenflow/spirits";

export type RollSeed = {
  userId: string;
  eggId: string;
  /** HMAC key (`SPIRIT_ROLL_SECRET`). Keeps the outcome unpredictable to the client. */
  secret: string;
};

/**
 * Deterministic hatch roll: the same student, egg and secret always hatch the
 * same spirit. A species' chance is proportional to 1 / rarity weight, so
 * rarer species hatch less often. `legendaryDue` limits the pool to legendary
 * species (pity).
 */
export function rollSpirit(
  { userId, eggId, secret }: RollSeed,
  legendaryDue = false,
): Spirit {
  const digest = createHmac("sha256", secret)
    .update(`${userId}:${eggId}`)
    .digest();
  const u =
    (digest.readUInt32BE(0) * 2 ** 32 + digest.readUInt32BE(4)) / 2 ** 64;
  const pool = legendaryDue
    ? SPIRITS.filter((s) => s.rarity === "legendary")
    : SPIRITS;
  const weights = pool.map((s) => 1 / RARITY_WEIGHT[s.rarity]);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += weights[i] / total;
    if (u < acc) return pool[i];
  }
  return pool[pool.length - 1];
}
