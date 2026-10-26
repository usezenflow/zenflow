import { Injectable } from "@nestjs/common";
import type { EngagementResponse } from "@zenflow/shared";
import { ActiveUsersService } from "../observability/active-users.service";

const DAILY_DAYS = 8;

/** Engagement for the dashboard: DAU and WAU from `ActiveUsersService`. */
@Injectable()
export class EngagementService {
  constructor(private readonly activeUsers: ActiveUsersService) {}

  async engagement(now = new Date()): Promise<EngagementResponse> {
    const [activeDays, wau] = await Promise.all([
      this.activeUsers.dailyCounts(now, DAILY_DAYS),
      this.activeUsers.weeklyCount(now),
    ]);
    return {
      dau: activeDays[activeDays.length - 1]?.dau ?? 0,
      wau,
      activeDays,
    };
  }
}
