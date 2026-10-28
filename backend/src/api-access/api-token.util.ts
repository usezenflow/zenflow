import { createHmac } from "crypto";

/** Access tokens issued by the OAuth server for AI assistants. */
export const OAUTH_ACCESS_PREFIX = "zo_";

/** The stored form of a secret: HMAC-SHA256 keyed by the server pepper, hex. */
export function hashApiToken(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}
