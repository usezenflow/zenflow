import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NTFY_TOPIC_RE } from "@zenflow/shared";
import type { PushMessage, SendResult } from "./types";

const TIMEOUT_MS = 10_000;

/** RFC 2047 encoded-word when the value is not ASCII; ntfy decodes it. */
function headerValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Delivery through an ntfy server: every device row's `pushToken` is a topic.
 *
 * Self-disabling: with no `NTFY_BASE_URL` the sender is inert and
 * {@link enabled} is false. Best-effort, never throws.
 */
@Injectable()
export class NtfySender {
  private readonly logger = new Logger(NtfySender.name);
  private readonly baseUrl?: string;
  private readonly token?: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("NTFY_BASE_URL")?.replace(/\/+$/, "");
    this.token = config.get<string>("NTFY_TOKEN");
    if (!this.baseUrl) this.logger.log("ntfy disabled (no NTFY_BASE_URL)");
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl);
  }

  async send(topics: string[], msg: PushMessage): Promise<SendResult> {
    const invalidTokens = topics.filter((t) => !NTFY_TOPIC_RE.test(t));
    if (!this.baseUrl) return { sent: 0, invalidTokens: [] };
    const headers: Record<string, string> = {
      Title: headerValue(msg.title),
      Priority: msg.tone === "urgent" ? "high" : "default",
      Click: `zenflow://${msg.data.url.replace(/^\//, "")}`,
      Tags: msg.data.eventName,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const results = await Promise.all(
      topics
        .filter((t) => NTFY_TOPIC_RE.test(t))
        .map(async (topic) => {
          try {
            const res = await fetch(`${this.baseUrl}/${topic}`, {
              method: "POST",
              headers,
              body: msg.body,
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) this.logger.warn(`ntfy send failed (${res.status})`);
            return res.ok;
          } catch (err) {
            this.logger.warn(`ntfy send threw (${(err as Error).message})`);
            return false;
          }
        }),
    );
    return { sent: results.filter(Boolean).length, invalidTokens };
  }
}
