import { Injectable, Logger } from "@nestjs/common";
import { type PushDataPayload, pushToneFor } from "@zenflow/shared";
import { type Notification } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { NtfySender } from "./ntfy.sender";
import type { PushMessage, SendResult } from "./types";
import { pushDevicesPruned, pushSend } from "../observability/metrics";
import { withSpan } from "../observability/otel";
import { localizeNotification } from "../notifications/localize-notification";
import type { PushProvider } from "../queue/queues";

/**
 * Wraps one provider call, e.g. with that provider's circuit breaker
 * (`ntfy`). The default runs it as is.
 */
export type ProviderGuard = <T>(
  provider: PushProvider,
  fn: () => Promise<T>,
) => Promise<T>;

const unguarded: ProviderGuard = (_provider, fn) => fn();

export interface SendOptions {
  /** With a guard that can park the job (breaker), the job re-runs the whole send. */
  guard?: ProviderGuard;
}

/** Every token of a provider failed transiently: worth a retry, and a breaker failure. */
export class PushProviderError extends Error {
  constructor(
    readonly provider: PushProvider,
    attempted: number,
  ) {
    super(`${provider}: all ${attempted} send(s) failed`);
    this.name = "PushProviderError";
  }
}

/**
 * Delivers one {@link Notification} to the user's registered devices. It is the
 * body of the `notify` queue's `push` job (`NotifyProcessor`); nothing
 * subscribes to the in-process emitter any more, so delivery is retried,
 * rate-limited and deduplicated by BullMQ rather than fired inline.
 *
 * A provider that answers nothing useful for every token throws
 * {@link PushProviderError} so the job retries with backoff and the
 * `ntfy` breaker counts it; a partial success is a success. Malformed topics
 * are pruned.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ntfy: NtfySender,
  ) {}

  /**
   * Load the notification and push it. Throws when the row is missing (the
   * producer may have enqueued before its transaction committed; the retry
   * finds it).
   */
  async deliver(notificationId: string, opts: SendOptions): Promise<void> {
    // A queue worker has no ambient async context: open a fresh root span.
    await withSpan("push.deliver", async () => {
      const row = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
      if (!row) throw new Error(`notification ${notificationId} not found`);
      await this.sendToUser(row.userId, row, opts);
    });
  }

  /**
   * Deliver one notification to every device `userId` has registered. A no-op
   * when ntfy is not configured or the user has no devices.
   */
  async sendToUser(
    userId: string,
    row: Notification,
    opts: SendOptions = {},
  ): Promise<void> {
    await this.sendMessage(
      userId,
      (lang) => {
        const local = localizeNotification(row, lang);
        return {
          title: local.title,
          body: local.content,
          data: this.dataFor(row),
          tone: pushToneFor(row.eventName),
        };
      },
      opts,
    );
  }

  /**
   * Deliver a message built from the user's language to every device they
   * have registered. `build` returns `null` to send nothing. Shared by the
   * notification path and the daily brief / check-in (issue #255).
   */
  async sendMessage(
    userId: string,
    build: (lang: string | undefined) => PushMessage | null,
    opts: SendOptions = {},
  ): Promise<void> {
    const guard = opts.guard ?? unguarded;
    if (!this.ntfy.enabled) {
      this.logger.warn(
        `sendToUser(${userId}): sender disabled — set NTFY_BASE_URL`,
      );
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { allowNotifications: true, lang: true },
    });
    if (user && !user.allowNotifications) return;
    const msg = build(user?.lang);
    if (!msg) return;

    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { pushToken: true },
    });
    if (devices.length === 0) {
      this.logger.warn(
        `sendToUser(${userId}): user has no registered devices (POST /devices first)`,
      );
      return;
    }

    const topics = devices.map((d) => d.pushToken);
    this.logger.log(`sendToUser(${userId}): ${topics.length} device(s)`);

    const { invalidTokens } = await this.sendVia(topics, msg, guard);
    if (invalidTokens.length > 0) {
      const { count } = await this.prisma.userDevice.deleteMany({
        where: { pushToken: { in: invalidTokens } },
      });
      this.logger.log(`pruned ${count} malformed device topic(s)`);
      pushDevicesPruned.add(count);
    }
  }

  private async sendVia(
    topics: string[],
    msg: PushMessage,
    guard: ProviderGuard,
  ): Promise<SendResult> {
    return guard("ntfy", async () => {
      const r = await this.ntfy.send(topics, msg);
      recordPushResult("ntfy", topics.length, r);
      this.logger.log(
        `ntfy: ${r.sent}/${topics.length} ok, ${r.invalidTokens.length} invalid`,
      );
      if (r.sent === 0 && r.invalidTokens.length === 0) {
        throw new PushProviderError("ntfy", topics.length);
      }
      return r;
    });
  }

  private dataFor(row: Notification): PushDataPayload {
    return {
      notificationId: row.id,
      eventName: row.eventName,
      sessionId: row.sessionId ?? "",
      slotProposalId: row.slotProposalId ?? "",
      url: row.sessionId
        ? `/calendar?session=${row.sessionId}`
        : "/notifications",
    };
  }
}

/** Split one provider's send result into sent / failed / invalid_token counts. */
function recordPushResult(
  provider: PushProvider,
  attempted: number,
  res: { sent: number; invalidTokens: string[] },
): void {
  if (attempted === 0) return;
  const invalid = res.invalidTokens.length;
  const failed = Math.max(0, attempted - res.sent - invalid);
  if (res.sent > 0) pushSend.add(res.sent, { provider, result: "sent" });
  if (failed > 0) pushSend.add(failed, { provider, result: "failed" });
  if (invalid > 0) pushSend.add(invalid, { provider, result: "invalid_token" });
}
