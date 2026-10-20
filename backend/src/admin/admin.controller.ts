import { Controller, Get, UseGuards } from "@nestjs/common";
import type {
  EngagementResponse,
  LearningQualityResponse,
  WorkloadResponse,
} from "@zenflow/shared";
import { CookieAuthGuard } from "../auth/guards";
import { AdminGuard } from "./admin.guard";
import { EngagementService } from "./engagement.service";
import { LearningQualityService } from "./learning-quality.service";
import { WorkloadService } from "./workload.service";

/** Read-only management data. Every route needs a signed-in admin. */
@Controller("admin")
@UseGuards(CookieAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly engagement: EngagementService,
    private readonly learningQuality: LearningQualityService,
    private readonly workload: WorkloadService,
  ) {}

  @Get("engagement")
  async getEngagement() {
    const data: EngagementResponse = await this.engagement.engagement();
    return { success: true, message: "Engagement loaded", data };
  }

  @Get("learning-quality")
  async getLearningQuality() {
    const data: LearningQualityResponse =
      await this.learningQuality.learningQuality();
    return { success: true, message: "Learning quality loaded", data };
  }

  @Get("workload")
  async getWorkload() {
    const data: WorkloadResponse = await this.workload.workload();
    return { success: true, message: "Workload loaded", data };
  }
}
