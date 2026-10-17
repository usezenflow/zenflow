import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import {
  SessionOutcome,
  UpstreamSessionCache,
} from "../integrations/upstream-session-cache.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { ingestionSignInFailures } from "../observability/metrics";
import { PortalAPIService } from "../portal/portal-api.service";

/**
 * Runs portal calls with a signed-in bearer token.
 *
 * The token comes from the {@link UpstreamSessionCache}, so a sync reuses a
 * recent sign-in. A token the portal rejects is replaced once; see
 * {@link UpstreamSessionCache.withSession}.
 *
 * `ok: false` when the portal refuses the sign-in or the credentials cannot be
 * read. An open upstream breaker surfaces as `UpstreamUnavailableError` so the
 * queue job can park behind it instead of counting a failure.
 */
@Injectable()
export class PortalSessionService {
  private readonly logger = new Logger(PortalSessionService.name);

  constructor(
    private readonly portal: PortalAPIService,
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
    private readonly sessions: UpstreamSessionCache,
  ) {}

  async withToken<R>(
    userId: string,
    use: (token: string) => Promise<R>,
  ): Promise<SessionOutcome<R>> {
    let creds: { username: string; password: string };
    try {
      creds = await this.integrations.revealCredentials(userId, "PORTAL");
    } catch (error) {
      ingestionSignInFailures.add(1, { provider: "PORTAL", reason: "error" });
      this.logger.warn(
        `Could not read portal credentials for user ${userId}: ${(error as Error).message}`,
      );
      return { ok: false };
    }

    const outcome = await this.sessions.withSession(
      userId,
      "portal",
      () => this.portal.authenticate(creds.username, creds.password),
      (session) => use(session.token),
    );
    if (!outcome.ok) {
      ingestionSignInFailures.add(1, {
        provider: "PORTAL",
        reason: "rejected",
      });
    }
    return outcome;
  }
}
