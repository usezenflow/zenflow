import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { EngagementService } from "./engagement.service";
import { LearningQualityService } from "./learning-quality.service";
import { WorkloadService } from "./workload.service";

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [
    AdminGuard,
    EngagementService,
    LearningQualityService,
    WorkloadService,
  ],
})
export class AdminModule {}
