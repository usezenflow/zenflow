import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import type { Redis } from "ioredis";
import type { IntegrationProvider } from "@zenflow/shared";
import {
  ENCRYPTION_ALGORITHM,
  IV_RANDOM_BYTES_SIZE,
} from "../common/constants";
import { UpstreamSessionRejectedError } from "../common/upstream-session-rejected.exception";
import { REDIS_CLIENT } from "../common/redis/redis.constants";
import { CryptoService } from "../crypto/crypto.service";
import { MasterKeyService } from "../crypto/master-key.service";
import { PrismaService } from "../prisma/prisma.service";

/** Which upstream session a value belongs to. `portal` and `dkhp` share the portal login. */
export type UpstreamKind = "portal" | "dkhp" | "lms";

/** Lifetime of each cached session. The LMS cookie and sesskey rotate as a pair, so they expire sooner. */
const TTL_SECONDS: Record<UpstreamKind, number> = {
  portal: 3 * 60 * 60,
  dkhp: 3 * 60 * 60,
  lms: 60 * 60,
};

const PROVIDER_OF: Record<UpstreamKind, IntegrationProvider> = {
  portal: "PORTAL",
  dkhp: "PORTAL",
  lms: "LMS",
};

/** Any upstream sign-in result: `ok` plus whatever the next request needs. */
interface SignInResult {
  ok: boolean;
}

/** `ok: false` means the upstream refused the sign-in; a transport failure throws instead. */
/** The successful variant of a sign-in result. */
type SignedIn<T> = Extract<T, { ok: true }>;

export type SessionOutcome<R> = { ok: true; value: R } | { ok: false };

interface Sealed {
  iv: string;
  authTag: string;
  encrypted: string;
}

export function upstreamKey(userId: string, kind: UpstreamKind): string {
  return `upstream:${userId}:${kind}`;
}

/**
 * Caches a student's successful upstream sign-in (portal bearer token, DKHP
 * token, LMS cookie and sesskey) in the session Redis, so a sync does not log
 * in to DLU on every run.
 *
 * Each value is sealed with the student's own data-encryption key, the same
 * envelope as the stored credentials, so Redis never holds a readable session.
 * Without a provisioned key the cache is skipped and every call logs in.
 *
 * {@link getOrLogin} is single-flight per process: concurrent callers for the
 * same student and kind share one login. Only a successful result is stored.
 */
@Injectable()
export class UpstreamSessionCache {
  private readonly logger = new Logger(UpstreamSessionCache.name);
  private readonly inflight = new Map<string, Promise<SignInResult>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly masterKeys: MasterKeyService,
  ) {}

  /** The cached sign-in for `kind`, or the result of one `login` call shared by concurrent callers. */
  async getOrLogin<T extends SignInResult>(
    userId: string,
    kind: UpstreamKind,
    login: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.read<T>(userId, kind);
    if (cached) return cached;

    const flightKey = upstreamKey(userId, kind);
    const pending = this.inflight.get(flightKey);
    if (pending) return pending as Promise<T>;

    const flight = (async () => {
      try {
        const result = await login();
        if (result.ok) await this.write(userId, kind, result);
        return result;
      } finally {
        this.inflight.delete(flightKey);
      }
    })();
    this.inflight.set(flightKey, flight);
    return flight;
  }

  /**
   * Runs `use` with the student's session. When the upstream rejects that
   * session, drops it, signs in once more and runs `use` once more. A second
   * rejection is thrown, so a bad session cannot loop.
   *
   * `ok: false` means the sign-in itself was refused.
   */
  async withSession<T extends SignInResult, R>(
    userId: string,
    kind: UpstreamKind,
    login: () => Promise<T>,
    use: (session: SignedIn<T>) => Promise<R>,
  ): Promise<SessionOutcome<R>> {
    const first = await this.getOrLogin(userId, kind, login);
    if (!first.ok) return { ok: false };
    try {
      return { ok: true, value: await use(first as SignedIn<T>) };
    } catch (error) {
      if (!(error instanceof UpstreamSessionRejectedError)) throw error;
    }

    await this.invalidate(userId, kind);
    const second = await this.getOrLogin(userId, kind, login);
    if (!second.ok) return { ok: false };
    return { ok: true, value: await use(second as SignedIn<T>) };
  }

  /** Drops every cached session for a student, e.g. after their credentials change. */
  async clear(userId: string): Promise<void> {
    const keys = (["portal", "dkhp", "lms"] as const).map((kind) =>
      upstreamKey(userId, kind),
    );
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn(
        `Could not clear upstream sessions: ${(error as Error).message}`,
      );
    }
  }

  /** Drops one cached session the upstream has rejected. */
  async invalidate(userId: string, kind: UpstreamKind): Promise<void> {
    try {
      await this.redis.del(upstreamKey(userId, kind));
    } catch (error) {
      this.logger.warn(
        `Could not drop an upstream session: ${(error as Error).message}`,
      );
    }
  }

  private async read<T>(userId: string, kind: UpstreamKind): Promise<T | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(upstreamKey(userId, kind));
    } catch {
      return null; // fail open: a missing cache costs a login, nothing more
    }
    if (!raw) return null;

    const dek = await this.dataKey(userId, PROVIDER_OF[kind]);
    if (!dek) return null;
    try {
      const sealed = JSON.parse(raw) as Sealed;
      const { decrypted } = this.crypto.decryptString({
        key: dek,
        iv: Buffer.from(sealed.iv, "hex"),
        algorithm: ENCRYPTION_ALGORITHM,
        encrypted: sealed.encrypted,
        authTag: sealed.authTag,
      });
      return JSON.parse(decrypted) as T;
    } catch {
      // A value that does not open is stale or tampered with; treat it as a miss.
      await this.invalidate(userId, kind);
      return null;
    }
  }

  private async write(
    userId: string,
    kind: UpstreamKind,
    result: SignInResult,
  ): Promise<void> {
    const dek = await this.dataKey(userId, PROVIDER_OF[kind]);
    if (!dek) return;
    const iv = randomBytes(IV_RANDOM_BYTES_SIZE);
    const { encrypted, authTag } = this.crypto.encryptString({
      key: dek,
      iv,
      algorithm: ENCRYPTION_ALGORITHM,
      secret: JSON.stringify(result),
    });
    const sealed: Sealed = { iv: iv.toString("hex"), authTag, encrypted };
    try {
      await this.redis.set(
        upstreamKey(userId, kind),
        JSON.stringify(sealed),
        "EX",
        TTL_SECONDS[kind],
      );
    } catch (error) {
      this.logger.warn(
        `Could not cache an upstream session: ${(error as Error).message}`,
      );
    }
  }

  /** The student's current plaintext data key for `provider`, or null when none is provisioned. */
  private async dataKey(
    userId: string,
    provider: IntegrationProvider,
  ): Promise<Buffer | null> {
    const row = await this.prisma.userEncryptionKey.findFirst({
      where: { userId, provider },
      orderBy: { version: "desc" },
    });
    if (!row) return null;
    try {
      return this.masterKeys.unwrap(provider, row);
    } catch {
      return null;
    }
  }
}
