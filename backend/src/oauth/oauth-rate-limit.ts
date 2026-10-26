import type { Request } from "express";
import { slidingWindowRule } from "../common/rate-limit";

const perIp = (namespace: string) => (req: Request) =>
  `${namespace}:ip:${req.ip}`;

/** The page is opened by an assistant's browser; the poll runs every 2 seconds for up to 10 minutes. */
export const connectPageRules = [
  slidingWindowRule("oauth-connect-page", perIp("oauth-connect"), () => ({
    window: 60,
    limit: 30,
  })),
];
export const connectPollRules = [
  slidingWindowRule("oauth-connect-poll", perIp("oauth-poll"), () => ({
    window: 60,
    limit: 120,
  })),
];

/** Tight, so a signed-in user cannot walk the code space (8 characters, 32 symbols). */
export const consentRules = [
  slidingWindowRule(
    "oauth-consent-user",
    (req: Request) => {
      const user: { id?: string } | undefined = req.user;
      return `oauth-consent:user:${user?.id ?? req.ip}`;
    },
    () => ({ window: 60, limit: 10 }),
  ),
];
