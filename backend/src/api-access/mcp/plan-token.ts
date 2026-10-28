import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const TTL_MS = 10 * 60_000;

/** Same value, same string: object keys sorted so the preview and the commit hash alike. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Proof that a change was previewed: a signed, expiring token bound to the
 * user, the tool and the exact arguments. The commit call must carry it, so an
 * assistant cannot write without showing the preview first. Stateless, so any
 * instance can verify what another issued.
 * shortcut: one random key per process when no pepper is set (dev), so tokens
 * die on restart; set API_TOKEN_PEPPER_V<n> in production.
 */
export class PlanTokens {
  private readonly key: string;

  constructor(pepper?: string) {
    this.key = pepper ?? randomBytes(32).toString("hex");
  }

  private mac(userId: string, tool: string, args: unknown, exp: number) {
    return createHmac("sha256", this.key)
      .update(`${userId}|${tool}|${exp}|${canonical(args)}`)
      .digest("hex");
  }

  issue(userId: string, tool: string, args: unknown, now = Date.now()) {
    const exp = now + TTL_MS;
    return `${exp}.${this.mac(userId, tool, args, exp)}`;
  }

  verify(
    planId: string,
    userId: string,
    tool: string,
    args: unknown,
    now = Date.now(),
  ): boolean {
    const [expText, sig = ""] = planId.split(".");
    const exp = Number(expText);
    if (!Number.isFinite(exp) || exp < now) return false;
    const want = Buffer.from(this.mac(userId, tool, args, exp));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
