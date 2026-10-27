import { Module } from "@nestjs/common";
import { PaletteService } from "./palette.service";
import { StudentService } from "./student.service";
import { UsersService } from "./users.service";
import { PrismaModule } from "../prisma/prisma.module";
import { UsersController } from "./users.controller";

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, StudentService, PaletteService],
  exports: [UsersService],
})
export class UsersModule {}
