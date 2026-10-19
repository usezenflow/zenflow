import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EggsController } from "./eggs.controller";
import { SpiritsController } from "./spirits.controller";
import { SpiritsService } from "./spirits.service";

@Module({
  imports: [PrismaModule],
  controllers: [SpiritsController, EggsController],
  providers: [SpiritsService],
  exports: [SpiritsService],
})
export class SpiritsModule {}
