import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PrepSizeRequest, PrepSizeResponse } from "@zenflow/shared";

/** Per-call budget for `POST /v1/prep/size`. Override with `PREP_SIZE_TIMEOUT_MS`. */
export const PREP_SIZE_TIMEOUT_MS = 2_500;

/**
 * HTTP client for the Python `POST /v1/prep/size` (level-up plan, Phase 1).
 *
 * Unlike {@link PlacementClient} there is no frozen fallback: sizing is Python
 * only, so a failure throws and the prep job retries under BullMQ's backoff.
 */
@Injectable()
export class PrepSizingClient {
  private readonly baseUrl?: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .get<string>("BANDIT_SERVICE_URL")
      ?.replace(/\/+$/, "");
    this.token = config.get<string>("BANDIT_SERVICE_TOKEN") || undefined;
    this.timeoutMs =
      Number(config.get("PREP_SIZE_TIMEOUT_MS")) || PREP_SIZE_TIMEOUT_MS;
  }

  async size(req: PrepSizeRequest): Promise<PrepSizeResponse> {
    if (!this.baseUrl) {
      throw new Error("BANDIT_SERVICE_URL is not set; cannot size prep plans");
    }
    const res = await fetch(`${this.baseUrl}/v1/prep/size`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`prep sizing failed: HTTP ${res.status}`);
    }
    return (await res.json()) as PrepSizeResponse;
  }
}
