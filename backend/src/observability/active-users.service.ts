import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../common/redis/redis.constants";
import { activeUsers } from "./metrics";

const DAY_SECONDS = 24 * 60 * 60;
const REFRESH_MS = 5 * 60_000;

/** The UTC day a user was seen on, as a HyperLogLog key. */
export function activeDayKey(now: Date): string {
  return `active:users:${now.toISOString().slice(0, 10)}`;
}

/** Keys for the last `days` UTC days, today first. */
export function activeDayKeys(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    activeDayKey(new Date(now.getTime() - i * DAY_SECONDS * 1000)),
  );
}

/**
 * Daily and weekly active users (level-up plan, #276) with one HyperLogLog per
 * UTC day. DAU is the count for today; WAU is the union of the last seven days.
 *
 * Writes come from {@link HttpMetricsInterceptor} on every authenticated
 * request. The gauges read a cached value refreshed on a timer, so a scrape never
 * waits on Redis. Both paths fail open: a Redis error loses data points, not requests.
 */
@Injectable()
export class ActiveUsersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActiveUsersService.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Marks `userId` active on the UTC day of `now`. */
  async record(userId: string, now = new Date()): Promise<void> {
    const key = activeDayKey(now);
    try {
      await this.redis
        .multi()
        .pfadd(key, userId)
        .expire(key, 8 * DAY_SECONDS)
        .exec();
    } catch (error) {
      this.logger.warn(
        `Could not record an active user: ${(error as Error).message}`,
      );
    }
  }

  /** Recomputes the DAU and WAU gauges from Redis. */
  async refresh(now = new Date()): Promise<void> {
    try {
      const [dau, wau] = await Promise.all([
        this.redis.pfcount(activeDayKey(now)),
        this.redis.pfcount(...activeDayKeys(now, 7)),
      ]);
      activeUsers.dau = dau;
      activeUsers.wau = wau;
    } catch (error) {
      this.logger.warn(
        `Could not refresh active users: ${(error as Error).message}`,
      );
    }
  }
}
