import { createHmac, timingSafeEqual } from "crypto";

/** What the consent page needs to finish an authorization the SDK has already validated. */
export interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
}

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/** Signed, expiring token that carries the request to the consent page and back. */
export function sealConsentRequest(
  request: ConsentRequest,
  secret: string,
  ttlMs: number,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ r: request, e: now + ttlMs }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function openConsentRequest(
  token: string,
  secret: string,
  now = Date.now(),
): ConsentRequest | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const { r, e } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { r: ConsentRequest; e: number };
    return e > now ? r : null;
  } catch {
    return null;
  }
}
