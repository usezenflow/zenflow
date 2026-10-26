import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type User } from "../../generated/prisma";
import { readVersionedSecret } from "../common/config/versioned-secret";
import { PrismaService } from "../prisma/prisma.service";
import { OAUTH_ACCESS_PREFIX, hashApiToken } from "./api-token.util";

/**
 * Resolves the user behind an OAuth access token an AI assistant was given.
 * Tokens are stored as a peppered HMAC; with no `API_TOKEN_PEPPER` nothing
 * authenticates.
 */
@Injectable()
export class ApiTokensService {
  /** Every configured pepper: a token is found under any of them, so rotation keeps old ones valid. */
  private readonly peppers: string[];

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const { values } = readVersionedSecret(
      (key) => config.get<string>(key),
      "API_TOKEN_PEPPER",
    );
    this.peppers = [...values.values()];
  }

  /** The owner of a live access token, or `null` for a malformed, unknown, expired or wrong-pepper secret. */
  async authenticate(secret: string, now = new Date()): Promise<User | null> {
    if (!this.peppers.length || !secret.startsWith(OAUTH_ACCESS_PREFIX))
      return null;
    const row = await this.prisma.oAuthToken.findFirst({
      where: {
        hash: { in: this.peppers.map((p) => hashApiToken(secret, p)) },
        kind: "ACCESS",
        expiresAt: { gt: now },
      },
      include: { user: true },
    });
    return row?.user ?? null;
  }
}
