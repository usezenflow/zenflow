import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "../../generated/prisma";
import { AdminGuard } from "./admin.guard";

function ctx(user: { role: UserRole } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("AdminGuard", () => {
  const guard = new AdminGuard();

  it("rejects a signed-in user without the admin role", () => {
    expect(() => guard.canActivate(ctx({ role: UserRole.USER }))).toThrow(
      ForbiddenException,
    );
  });

  it("lets an admin through", () => {
    expect(guard.canActivate(ctx({ role: UserRole.ADMIN }))).toBe(true);
  });
});
