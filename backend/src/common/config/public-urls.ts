import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Public addresses of this deployment, used for redirects, webhooks and OAuth metadata. */
@Injectable()
export class PublicUrls {
  constructor(private readonly config: ConfigService) {}

  /** API base incl. the global prefix, e.g. https://api.usezenflow.com/api/v1 */
  get api(): string {
    return (this.config.get<string>("PUBLIC_API_URL") ?? "").replace(/\/$/, "");
  }

  /** The public website; defaults to the first CORS origin. */
  get web(): string {
    const explicit = this.config.get<string>("PUBLIC_WEB_URL");
    const first = (this.config.get<string>("CORS_ORIGIN") ?? "").split(",")[0];
    return (explicit ?? first ?? "").trim().replace(/\/$/, "");
  }
}
