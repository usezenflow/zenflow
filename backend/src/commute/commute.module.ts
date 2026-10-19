import { Module } from "@nestjs/common";
import { PlacesModule } from "../places/places.module";
import { PrismaModule } from "../prisma/prisma.module";
import { CommuteDefaultsService } from "./commute-defaults.service";

@Module({
  imports: [PrismaModule, PlacesModule],
  providers: [CommuteDefaultsService],
  exports: [CommuteDefaultsService],
})
export class CommuteModule {}
