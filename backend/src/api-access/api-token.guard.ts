import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { assertCookieSession } from "../auth/guards/cookie-auth.guard";
import { isEmailDomainAllowed } from "../auth/utils/email-domain";
import { API_TOKEN_ROUTE_KEY } from "./allow-api-token.decorator";
import { ApiTokensService } from "./api-tokens.service";

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Cookie sessions as before. A `Bearer` header is checked against personal API
 * tokens, and only on routes marked `@AllowApiToken()` or `@ApiTokenOnly()`.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: ApiTokensService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const bearer = BEARER.exec(request.headers.authorization ?? "");
    const mode = this.reflector.getAllAndOverride<string | undefined>(
      API_TOKEN_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!bearer) {
      if (mode === "only") throw new UnauthorizedException();
      assertCookieSession(request);
      return true;
    }
    if (!mode) {
      throw new ForbiddenException("API tokens cannot call this route");
    }
    const user = await this.tokens.authenticate(bearer[1]);
    if (!user || !isEmailDomainAllowed(user.email)) {
      throw new UnauthorizedException();
    }
    request.user = user;
    return true;
  }
}
