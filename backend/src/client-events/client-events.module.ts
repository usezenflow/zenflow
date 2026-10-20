import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ClientEventsController } from "./client-events.controller";
import { ClientEventsService } from "./client-events.service";

@Module({
  imports: [PrismaModule],
  controllers: [ClientEventsController],
  providers: [ClientEventsService],
})
export class ClientEventsModule {}
