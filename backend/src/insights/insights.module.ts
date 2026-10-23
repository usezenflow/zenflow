import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { InsightsController } from "./insights.controller";
import { InsightsService } from "./insights.service";

@Module({
  imports: [PrismaModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
