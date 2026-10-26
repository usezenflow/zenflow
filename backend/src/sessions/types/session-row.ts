import type { Prisma } from "../../../generated/prisma";

/** A `Session` row with its (nullable) parent series — the shape every
 * sessions service method loads and maps to the wire response. */
export type SessionRow = Prisma.SessionGetPayload<{
  include: { series: true };
}>;

/** The Prisma `include` that produces a {@link SessionRow}. */
export const WITH_SERIES = {
  series: true,
} as const;
