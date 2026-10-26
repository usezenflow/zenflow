import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { type OAuthTokenKind } from "../../generated/prisma";
import { OAUTH_ACCESS_PREFIX } from "../api-access/api-token.util";
import { PrismaService } from "../prisma/prisma.service";
import { sealConsentRequest } from "./consent-request";
import {
  ACCESS_TTL_MS,
  CLIENT_REGISTRATION_LIMIT,
  CODE_TTL_MS,
  CONSENT_TTL_MS,
  MCP_SCOPE,
  OAuthConfig,
  REFRESH_TTL_MS,
} from "./oauth.config";

const PREFIX: Record<OAuthTokenKind, string> = {
  CODE: "zc_",
  ACCESS: OAUTH_ACCESS_PREFIX,
  REFRESH: "zr_",
};

const newSecret = (kind: OAuthTokenKind) =>
  PREFIX[kind] + randomBytes(32).toString("base64url");

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** Throws unless the URI is absolute, has no fragment, and is https or loopback http. */
function checkRedirectUri(uri: string): void {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new InvalidClientMetadataError("redirect_uris must be absolute URLs");
  }
  if (url.hash)
    throw new InvalidClientMetadataError(
      "redirect_uris must not have a fragment",
    );
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopback(url.hostname))
  )
    throw new InvalidClientMetadataError("redirect_uris must use https");
}

/** Clients compare equal with a trailing slash or fragment ignored, as the SDK does. */
const sameResource = (a: string, b: string): boolean =>
  a.replace(/#.*$/, "").replace(/\/$/, "") ===
  b.replace(/#.*$/, "").replace(/\/$/, "");

/**
 * The authorization server behind the MCP endpoint (OAuth 2.1, PKCE, dynamic
 * client registration). The SDK router speaks the protocol; this class stores
 * clients and tokens. Only an HMAC of each secret is kept, a code works once,
 * and presenting a spent refresh token revokes everything issued from it.
 */
@Injectable()
export class OAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: OAuthConfig,
  ) {}

  readonly clientsStore: OAuthRegisteredClientsStore = {
    getClient: async (clientId) => {
      const row = await this.prisma.oAuthClient.findUnique({
        where: { id: clientId },
      });
      return row
        ? ({
            ...(row.metadata as object),
            client_id: row.id,
          } as OAuthClientInformationFull)
        : undefined;
    },
    registerClient: async (client) => {
      const info = client as OAuthClientInformationFull;
      info.redirect_uris.forEach(checkRedirectUri);
      const recent = await this.prisma.oAuthClient.count({
        where: { createdAt: { gt: new Date(Date.now() - 3_600_000) } },
      });
      if (recent >= CLIENT_REGISTRATION_LIMIT)
        throw new InvalidClientMetadataError(
          "Too many clients registered. Try again later.",
        );
      await this.prisma.oAuthClient.create({
        data: {
          id: info.client_id,
          name: info.client_name?.slice(0, 120) ?? null,
          metadata: info,
        },
      });
      return info;
    },
  };

  /** Hands the validated request to the consent page, which needs a signed-in user. */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const resource = this.resourceFor(params.resource);
    const { id: nonce } = await this.prisma.oAuthConsent.create({
      data: {
        clientId: client.client_id,
        expiresAt: new Date(Date.now() + CONSENT_TTL_MS),
      },
      select: { id: true },
    });
    const request = sealConsentRequest(
      {
        nonce,
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes: params.scopes?.length ? params.scopes : [MCP_SCOPE],
        resource,
      },
      this.config.signingSecret,
      CONSENT_TTL_MS,
    );
    res.redirect(
      `${this.config.consentUrl}?request=${encodeURIComponent(request)}`,
    );
  }

  /** Issues the one-time code once the user approves. Returns the code. */
  async issueCode(
    userId: string,
    request: {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      scopes: string[];
      resource: string;
    },
  ): Promise<string> {
    const secret = newSecret("CODE");
    await this.prisma.oAuthToken.create({
      data: {
        kind: "CODE",
        hash: this.hash(secret),
        familyId: randomBytes(16).toString("hex"),
        scope: request.scopes.join(" "),
        codeChallenge: request.codeChallenge,
        redirectUri: request.redirectUri,
        resource: request.resource,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        clientId: request.clientId,
        userId,
      },
    });
    return secret;
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    const row = await this.find("CODE", code);
    if (!row || row.clientId !== client.client_id || !row.codeChallenge) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const row = await this.find("CODE", code);
    if (!row || row.clientId !== client.client_id)
      throw new InvalidGrantError("Invalid authorization code");
    if (row.usedAt) {
      // A code is single use; a replay means it leaked, so drop what it produced.
      await this.revokeFamily(row.familyId);
      throw new InvalidGrantError("Authorization code already used");
    }
    if (row.expiresAt <= new Date())
      throw new InvalidGrantError("Authorization code expired");
    if (row.redirectUri && redirectUri !== row.redirectUri)
      throw new InvalidGrantError("redirect_uri does not match");
    if (resource && !this.issuedFor(row, resource))
      throw new InvalidGrantError("resource does not match");
    await this.spend(row.id);
    return this.issueTokens(row);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const row = await this.find("REFRESH", refreshToken);
    if (!row || row.clientId !== client.client_id)
      throw new InvalidGrantError("Invalid refresh token");
    if (row.usedAt) {
      await this.revokeFamily(row.familyId);
      throw new InvalidGrantError("Refresh token already used");
    }
    if (row.expiresAt <= new Date())
      throw new InvalidGrantError("Refresh token expired");
    if (resource && !this.issuedFor(row, resource))
      throw new InvalidGrantError("resource does not match");
    await this.spend(row.id);
    return this.issueTokens(row);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await this.find("ACCESS", token);
    if (!row || row.expiresAt <= new Date())
      throw new InvalidTokenError("Invalid or expired token");
    return {
      token,
      clientId: row.clientId,
      scopes: row.scope ? row.scope.split(" ") : [],
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      resource: new URL(row.resource ?? this.config.mcpUrl.href),
      extra: { userId: row.userId },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const row = await this.prisma.oAuthToken.findUnique({
      where: { hash: this.hash(request.token) },
    });
    if (row && row.clientId === client.client_id)
      await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.oAuthToken.deleteMany({ where: { familyId } });
  }

  hash(secret: string): string {
    return createHmac("sha256", this.config.pepper)
      .update(secret)
      .digest("hex");
  }

  /** Only the MCP endpoint is a protected resource, so anything else is refused. */
  private resourceFor(resource: URL | undefined): string {
    const expected = this.config.mcpUrl.href;
    if (resource && !sameResource(resource.href, expected))
      throw new InvalidTargetError("resource must be the Zenflow MCP endpoint");
    return expected;
  }

  /** Rows from before `resource` was stored were all issued for the MCP endpoint. */
  private issuedFor(row: { resource: string | null }, resource: URL): boolean {
    return sameResource(resource.href, row.resource ?? this.config.mcpUrl.href);
  }

  private find(kind: OAuthTokenKind, secret: string) {
    if (!secret.startsWith(PREFIX[kind])) return Promise.resolve(null);
    return this.prisma.oAuthToken.findFirst({
      where: { hash: this.hash(secret), kind },
    });
  }

  /** Marks a code or refresh token spent. Losing the race to a concurrent use counts as a replay. */
  private async spend(id: string): Promise<void> {
    const { count } = await this.prisma.oAuthToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw new InvalidGrantError("Token already used");
  }

  private async issueTokens(from: {
    familyId: string;
    clientId: string;
    userId: string;
    scope: string;
    resource: string | null;
  }): Promise<OAuthTokens> {
    const access = newSecret("ACCESS");
    const refresh = newSecret("REFRESH");
    const now = Date.now();
    await this.prisma.oAuthToken.createMany({
      data: [
        {
          kind: "ACCESS",
          hash: this.hash(access),
          expiresAt: new Date(now + ACCESS_TTL_MS),
        },
        {
          kind: "REFRESH",
          hash: this.hash(refresh),
          expiresAt: new Date(now + REFRESH_TTL_MS),
        },
      ].map((t) => ({
        ...t,
        kind: t.kind as OAuthTokenKind,
        familyId: from.familyId,
        clientId: from.clientId,
        userId: from.userId,
        scope: from.scope,
        resource: from.resource ?? this.config.mcpUrl.href,
      })),
    });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refresh,
      scope: from.scope,
    };
  }
}
