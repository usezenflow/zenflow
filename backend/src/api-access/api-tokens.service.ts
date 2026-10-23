import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  ApiTokenSummary,
  CreateApiTokenInput,
  CreateApiTokenResponse,
  RevokeApiTokenResponse,
} from "@zenflow/shared";
import { type ApiToken, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  API_TOKEN_PREFIX,
  generateApiTokenSecret,
  hashApiToken,
} from "./api-token.util";

/** `lastUsedAt` is written at most once per this window. */
export const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;

export function toApiTokenSummary(row: ApiToken): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

/**
 * Personal API tokens. The secret is shown once; only its peppered HMAC is
 * stored. With no `API_TOKEN_PEPPER` the feature is off: create answers 503,
 * authenticate answers no user.
 */
@Injectable()
export class ApiTokensService {
  private readonly logger = new Logger(ApiTokensService.name);
  private readonly pepper: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.pepper = config.get<string>("API_TOKEN_PEPPER") || undefined;
  }

  async list(user: User): Promise<ApiTokenSummary[]> {
    const rows = await this.prisma.apiToken.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toApiTokenSummary);
  }

  async create(
    user: User,
    input: CreateApiTokenInput,
  ): Promise<CreateApiTokenResponse> {
    if (!this.pepper) {
      throw new ServiceUnavailableException("API access is not configured");
    }
    const secret = generateApiTokenSecret();
    const row = await this.prisma.apiToken.create({
      data: {
        name: input.name,
        hash: hashApiToken(secret, this.pepper),
        userId: user.id,
      },
    });
    return { token: toApiTokenSummary(row), secret };
  }

  async revoke(user: User, id: string): Promise<RevokeApiTokenResponse> {
    const row = await this.prisma.apiToken.findFirst({
      where: { id, userId: user.id },
    });
    if (!row) throw new NotFoundException("API token not found");
    if (!row.revokedAt) {
      await this.prisma.apiToken.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    }
    return { revoked: true };
  }

  /**
   * The owner of a live token, or `null` for a malformed, unknown, revoked or
   * wrong-pepper secret. Stamps `lastUsedAt` at most once per interval.
   */
  async authenticate(secret: string, now = new Date()): Promise<User | null> {
    if (!this.pepper || !secret.startsWith(API_TOKEN_PREFIX)) return null;
    const row = await this.prisma.apiToken.findUnique({
      where: { hash: hashApiToken(secret, this.pepper) },
      include: { user: true },
    });
    if (!row || row.revokedAt) return null;
    await this.touch(row.id, row.lastUsedAt, now);
    return row.user;
  }

  /** Conditional write, so concurrent requests stamp at most one update. */
  private async touch(
    id: string,
    lastUsedAt: Date | null,
    now: Date,
  ): Promise<void> {
    const staleBefore = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS);
    if (lastUsedAt && lastUsedAt > staleBefore) return;
    try {
      await this.prisma.apiToken.updateMany({
        where: {
          id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: staleBefore } }],
        },
        data: { lastUsedAt: now },
      });
    } catch (err) {
      this.logger.warn(`api token lastUsedAt not stamped: ${String(err)}`);
    }
  }
}
