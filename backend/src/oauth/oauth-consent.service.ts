import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  ConnectedAppsResponse,
  OAuthConsentDecisionResponse,
  OAuthConsentInfo,
} from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { openConsentRequest } from "./consent-request";
import { OAuthConfig } from "./oauth.config";
import { OAuthProvider } from "./oauth.provider";
import { normalizeUserCode } from "./user-code";

const EXPIRED = "This request expired. Start again from your assistant.";
const UNREGISTERED =
  "This assistant cannot redirect there. Start again from your assistant.";
const CHECK_CODE = "Check the code and try again.";

/** What the connect page shows, or what its poll learns. */
export type ConnectPoll =
  | { status: "pending" }
  | { status: "done"; redirectUrl: string }
  | { status: "expired" };

/**
 * The two halves of approving an assistant. The browser page shows a code and
 * waits ({@link waiting}, {@link poll}); the signed-in app enters the code and
 * approves or refuses ({@link describe}, {@link decide}).
 */
@Injectable()
export class OAuthConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: OAuthConfig,
    private readonly provider: OAuthProvider,
  ) {}

  /** The code and assistant name for the browser page; null once the request is gone. */
  async waiting(
    requestToken: string,
  ): Promise<{ code: string; clientName: string } | null> {
    const request = openConsentRequest(requestToken, this.config.signingSecret);
    if (!request) return null;
    const row = await this.prisma.oAuthConsent.findUnique({
      where: { id: request.nonce },
      select: { userCode: true, usedAt: true, expiresAt: true },
    });
    if (!row || row.usedAt || row.expiresAt <= new Date()) return null;
    const client = await this.prisma.oAuthClient.findUnique({
      where: { id: request.clientId },
    });
    return {
      code: row.userCode,
      clientName: client?.name ?? "An AI assistant",
    };
  }

  /** Where the browser page should go next. The redirect is handed out once. */
  async poll(requestToken: string): Promise<ConnectPoll> {
    const request = openConsentRequest(requestToken, this.config.signingSecret);
    if (!request) return { status: "expired" };
    const row = await this.prisma.oAuthConsent.findUnique({
      where: { id: request.nonce },
      select: { redirectUrl: true, expiresAt: true },
    });
    if (!row) return { status: "expired" };
    const redirectUrl = row.redirectUrl;
    if (redirectUrl) {
      const { count } = await this.prisma.oAuthConsent.updateMany({
        where: { id: request.nonce, redirectUrl },
        data: { redirectUrl: null },
      });
      return count === 1
        ? { status: "done", redirectUrl }
        : { status: "expired" };
    }
    return row.expiresAt > new Date()
      ? { status: "pending" }
      : { status: "expired" };
  }

  async describe(user: User, code: string): Promise<OAuthConsentInfo> {
    const request = await this.open(code);
    await this.bind(user, request.nonce, {});
    const client = await this.prisma.oAuthClient.findUnique({
      where: { id: request.clientId },
    });
    if (!client) throw new BadRequestException(EXPIRED);
    return {
      clientName: client.name ?? "An AI assistant",
      redirectHost: new URL(request.redirectUri).host,
      scopes: request.scopes,
    };
  }

  async decide(
    user: User,
    code: string,
    approve: boolean,
  ): Promise<OAuthConsentDecisionResponse> {
    const request = await this.open(code);
    const client = await this.prisma.oAuthClient.findUnique({
      where: { id: request.clientId },
    });
    // Metadata can change after the request was sealed; check it again before redirecting.
    const registered = (client?.metadata as { redirect_uris?: string[] } | null)
      ?.redirect_uris;
    if (!registered?.includes(request.redirectUri))
      throw new BadRequestException(UNREGISTERED);
    await this.bind(user, request.nonce, { usedAt: new Date() });
    const target = new URL(request.redirectUri);
    if (approve) {
      target.searchParams.set(
        "code",
        await this.provider.issueCode(user.id, request),
      );
    } else {
      target.searchParams.set("error", "access_denied");
    }
    if (request.state) target.searchParams.set("state", request.state);
    await this.prisma.oAuthConsent.update({
      where: { id: request.nonce },
      data: { redirectUrl: target.toString() },
    });
    return { approved: approve };
  }

  async apps(user: User): Promise<ConnectedAppsResponse> {
    const grants = await this.prisma.oAuthToken.groupBy({
      by: ["clientId"],
      where: {
        userId: user.id,
        kind: "REFRESH",
        expiresAt: { gt: new Date() },
      },
      _min: { createdAt: true },
    });
    const clients = await this.prisma.oAuthClient.findMany({
      where: { id: { in: grants.map((g) => g.clientId) } },
      select: { id: true, name: true },
    });
    const names = new Map(clients.map((c) => [c.id, c.name]));
    return {
      apps: grants.map((g) => ({
        clientId: g.clientId,
        name: names.get(g.clientId) ?? "AI assistant",
        connectedAt: g._min.createdAt!.toISOString(),
      })),
    };
  }

  async revokeApp(
    user: User,
    clientId: string,
  ): Promise<ConnectedAppsResponse> {
    await this.prisma.oAuthToken.deleteMany({
      where: { userId: user.id, clientId },
    });
    return this.apps(user);
  }

  /** The signed request behind a typed code. */
  private async open(typed: string) {
    const code = normalizeUserCode(typed);
    const row = code
      ? await this.prisma.oAuthConsent.findUnique({
          where: { userCode: code },
          select: { request: true },
        })
      : null;
    if (!row) throw new BadRequestException(CHECK_CODE);
    const request = openConsentRequest(row.request, this.config.signingSecret);
    if (!request) throw new BadRequestException(EXPIRED);
    return request;
  }

  /**
   * Binds an open request to the first signed-in user who touches it, and
   * spends it when `data.usedAt` is set. Any later attempt fails, so a
   * request is single use and only its owner can finish it.
   */
  private async bind(
    user: User,
    nonce: string,
    data: { usedAt?: Date },
  ): Promise<void> {
    const { count } = await this.prisma.oAuthConsent.updateMany({
      where: {
        id: nonce,
        usedAt: null,
        expiresAt: { gt: new Date() },
        OR: [{ userId: null }, { userId: user.id }],
      },
      data: { userId: user.id, ...data },
    });
    if (count !== 1) throw new BadRequestException(EXPIRED);
  }
}
