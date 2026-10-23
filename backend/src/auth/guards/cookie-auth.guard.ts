import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { isEmailDomainAllowed } from "../utils/email-domain";

/** Throws 401 unless the request carries a live, allowed Redis session. */
export function assertCookieSession(request: Request): void {
  const isAuthenticated = request.isAuthenticated();
  if (!isAuthenticated) throw new UnauthorizedException();
  // `ALLOWED_EMAIL_DOMAINS`: a session opened before the rule shipped (they
  // are rolling and last 7 days from the last use) must not outlive it.
  const email = (request.user as { email?: string } | undefined)?.email;
  if (email && !isEmailDomainAllowed(email)) throw new UnauthorizedException();
}

export class CookieAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    assertCookieSession(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
