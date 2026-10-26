import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { OutboundBreakers } from "../common/outbound-breaker";
import { PushService } from "../devices/push.service";
import { QueueWorkers } from "../queue/queue-workers.service";
import { NOTIFY_QUEUE, type NotifyJobData } from "../queue/queues";
import { withBreaker } from "../queue/with-breaker";

/**
 * The `notify` queue consumer (role `worker-notify`, `worker`, `all`):
 * `push` -> {@link PushService}. Each handler throws on a real failure
 * (BullMQ retries with backoff, then dead-letters) and returns normally when
 * there is nothing to send. Push runs under the `ntfy` breaker: when it is
 * open the job is parked without using an attempt.
 */
@Injectable()
export class NotifyProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(
    private readonly workers: QueueWorkers,
    private readonly push: PushService,
    private readonly breakers: OutboundBreakers,
    private readonly killSwitch: KillSwitchService,
  ) {}

  onModuleInit(): void {
    this.workers.register(NOTIFY_QUEUE, (job, token) =>
      this.process(job, token),
    );
  }

  async process(job: Job<NotifyJobData>, token?: string): Promise<void> {
    const data = job.data;
    // Kill switch: drop the job (no retry).
    if (!(await this.killSwitch.isEnabled("notifications"))) {
      this.logger.warn(`notifications disabled, dropping job ${job.id}`);
      return;
    }
    switch (data.type) {
      case "push":
        // A job queued for a removed provider (fcm, apns, web) cannot run.
        if (data.provider !== "ntfy") {
          throw new UnrecoverableError(`push job ${job.id} has no provider`);
        }
        return this.push.deliver(data.notificationId, {
          guard: (provider, fn) =>
            withBreaker(this.breakers, provider, job, token, fn, {
              queue: NOTIFY_QUEUE.name,
            }),
        });
      default:
        this.logger.warn(`unknown notify job ${job.id}`);
    }
  }
}
