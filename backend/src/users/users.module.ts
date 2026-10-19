import { Module } from "@nestjs/common";
import { StudentService } from "./student.service";
import { UsersService } from "./users.service";
import { CommuteModule } from "../commute/commute.module";
import { PrismaModule } from "../prisma/prisma.module";
import { UsersController } from "./users.controller";

@Module({
  imports: [PrismaModule, CommuteModule],
  controllers: [UsersController],
  providers: [UsersService, StudentService],
  exports: [UsersService],
})
export class UsersModule {}
