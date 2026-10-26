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

const EXPIRED = "This request expired. Start again from your assistant.";
const UNREGISTERED =
  "This assistant cannot redirect there. Start again from your assistant.";

/** The signed-in half of the flow: the user sees who is asking and approves or refuses. */
@Injectable()
export class OAuthConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: OAuthConfig,
    private readonly provider: OAuthProvider,
  ) {}

  async describe(user: User, requestToken: string): Promise<OAuthConsentInfo> {
    const request = this.open(requestToken);
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
    requestToken: string,
    approve: boolean,
  ): Promise<OAuthConsentDecisionResponse> {
    const request = this.open(requestToken);
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
    return { redirectUrl: target.toString() };
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

  private open(token: string) {
    const request = openConsentRequest(token, this.config.signingSecret);
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
