# ADR-0038: Personal API access for AI assistants

**Status:** Accepted
**Date:** 2026-10-23

## Context
Students want an assistant to read their schedule and add tasks. A third-party assistant cannot use the browser's session cookie. Auth stays OTP plus Redis sessions, with no passwords or JWT, so assistants get a separate token.

## Decision
- A personal API token is `zf_` plus 256 random bits, shown once. The database stores only `HMAC-SHA256(secret, API_TOKEN_PEPPER)` in `ApiToken.hash` (unique, lookup key).
- `lastUsedAt` is written at most once per 5 minutes, as a conditional `updateMany`.
- Management stays on the cookie session: `GET /users/me/api-access`, `POST /users/me/api-access/tokens`, `DELETE /users/me/api-access/tokens/:id`.
- `ApiTokenGuard` accepts `Authorization: Bearer zf_...`. It applies only to routes marked `@AllowApiToken()` (any bearer request elsewhere gets 403) or `@ApiTokenOnly()` (cookie refused, 401). A cookie session works as before.
- MCP is streamable HTTP at `/api/v1/mcp`, bearer only, stateless. The official TypeScript SDK (`@modelcontextprotocol/sdk`) provides the transport.
- Tool handlers call the same services as the REST routes. No separate write path.
- Each token is tied to one user; revoking sets `revokedAt` and the token stops working on the next request.

## Consequences
- Rotating `API_TOKEN_PEPPER` revokes every token at once. The variable is required in production; without it API access is off (create returns 503, bearer requests get 401).
- A leaked database alone does not reveal usable secrets, because the pepper lives in the environment.
- Routes opt in one by one. Each new bearer route needs a test that proves it is allowed and that the others still refuse.

## Contract deltas
- Routes: `GET /users/me/api-access`, `POST /users/me/api-access/tokens`, `DELETE /users/me/api-access/tokens/:id`, `POST /mcp`.
- `@zenflow/shared` (`api-access.ts`): `ApiAccessResponse`, `ApiTokenSummary`, `CreateApiTokenInput`, `CreateApiTokenResponse`, `RevokeApiTokenResponse`.
- Prisma: `ApiToken` (`id`, `name`, `hash`, `createdAt`, `lastUsedAt`, `revokedAt`, `userId`), migration `20261023100000_personal_api_access`.
- Env: `API_TOKEN_PEPPER`.
