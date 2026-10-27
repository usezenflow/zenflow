import type { Request } from "express";
import { slidingWindowRule } from "../common/rate-limit";

/** Pull on login, debounced pushes after edits; per user. */
export const paletteRules = [
  slidingWindowRule(
    "palette-user",
    (req: Request) => {
      const user: { id?: string } | undefined = req.user;
      return `palette:user:${user?.id ?? req.ip}`;
    },
    () => ({ window: 60, limit: 30 }),
  ),
];
