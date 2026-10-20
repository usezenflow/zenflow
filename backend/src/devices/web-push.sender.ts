import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import {
  toStringMap,
  type PushMessage,
  type SendResult,
  type WebPushTarget,
} from "./types";

/** Seconds the push service holds a message for an offline browser, then drops it. */
const WEB_PUSH_TTL_SECONDS = 60 * 60;

/** Per-subscription request timeout, ms. */
const WEB_PUSH_TIMEOUT_MS = 10_000;

/** Push-service statuses that mean the subscription is gone for good. */
const WEB_DEAD_ENDPOINT_STATUSES = new Set<number>([404, 410]);

/**
 * Web delivery via the Web Push protocol (VAPID auth, aes128gcm payload).
 *
 * Self-disabling: unless all of `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
 * `VAPID_SUBJECT` resolve, the sender is inert and {@link enabled} is false.
 * Best-effort — never throws; only reports which endpoints to prune.
 */
@Injectable()
export class WebPushSender {
  private readonly logger = new Logger(WebPushSender.name);
  private readonly vapidPublicKey: string | null = null;

  constructor(configService: ConfigService) {
    const publicKey = configService.get<string>("VAPID_PUBLIC_KEY");
    const privateKey = configService.get<string>("VAPID_PRIVATE_KEY");
    const subject = configService.get<string>("VAPID_SUBJECT");
    if (!publicKey || !privateKey || !subject) {
      this.logger.log("Web Push disabled (VAPID_* not fully configured)");
      return;
    }
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidPublicKey = publicKey;
      this.logger.log("Web Push enabled");
    } catch (err) {
      this.logger.error(`Web Push disabled: ${(err as Error).message}`);
    }
  }

  get enabled(): boolean {
    return this.vapidPublicKey !== null;
  }

  /** The VAPID public key a browser subscribes with; `null` while disabled. */
  get publicKey(): string | null {
    return this.vapidPublicKey;
  }

  async send(targets: WebPushTarget[], msg: PushMessage): Promise<SendResult> {
    if (!this.enabled || targets.length === 0) {
      return { sent: 0, invalidTokens: [] };
    }

    // The service worker reads `category` for action buttons and `data` for routing.
    const payload = JSON.stringify({
      title: msg.title,
      body: msg.body,
      tone: msg.tone,
      category: msg.category ?? null,
      data: {
        ...toStringMap(msg.data),
        slotProposalId: msg.data.slotProposalId,
        ...msg.extra,
      },
    });
    const options: webpush.RequestOptions = {
      TTL: WEB_PUSH_TTL_SECONDS,
      timeout: WEB_PUSH_TIMEOUT_MS,
      urgency: msg.tone === "urgent" ? "high" : "normal",
    };

    const settled = await Promise.allSettled(
      targets.map((t) =>
        webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          payload,
          options,
        ),
      ),
    );
    let sent = 0;
    const invalidTokens: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        sent++;
        return;
      }
      const status = statusOf(r.reason);
      if (status !== undefined && WEB_DEAD_ENDPOINT_STATUSES.has(status)) {
        invalidTokens.push(targets[i].endpoint);
      } else {
        this.logger.warn(`Web Push send failed (${status ?? "network"})`);
      }
    });
    return { sent, invalidTokens };
  }
}

/** The HTTP status a web-push error carries, if any. */
function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "statusCode" in err) {
    const code = err.statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}
