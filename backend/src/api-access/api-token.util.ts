import { createHmac, randomBytes } from "crypto";

/** Every personal API token secret starts with this prefix. */
export const API_TOKEN_PREFIX = "zf_";

/** Access tokens issued by the OAuth server for AI assistants. */
export const OAUTH_ACCESS_PREFIX = "zo_";

/** A new secret: 256 random bits, base64url, behind the prefix. */
export function generateApiTokenSecret(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** The stored form of a secret: HMAC-SHA256 keyed by the server pepper, hex. */
export function hashApiToken(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}
