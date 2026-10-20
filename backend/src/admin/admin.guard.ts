import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { UserRole, type User } from "../../generated/prisma";

/** Lets an admin through. Chain after `CookieAuthGuard`, which signs the request in. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();
    const user = request.user as User | undefined;
    if (user?.role !== UserRole.ADMIN) throw new ForbiddenException();
    return true;
  }
}
