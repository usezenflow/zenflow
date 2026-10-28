# ADR-0041: OAuth for AI assistants

**Status:** accepted, consent screen superseded by ADR-0046
**Date:** 2026-10-25
**Issue:** none

## Context
- Most students use free plans. ChatGPT Free connects only apps listed in OpenAI's directory, and its Developer mode needs a paid plan. Gemini accepts custom MCP servers only for personal accounts in the US, in English. Claude Free allows one custom connector.
- Static bearer headers are a beta in Claude and are not offered by ChatGPT or Gemini. OAuth is the one flow all three support.

## Decision
- Zenflow is its own OAuth 2.1 authorization server for `/mcp`, built on the MCP SDK router: discovery metadata, dynamic client registration, authorize, token and revoke at the API origin root.
- Public clients with PKCE `S256`. Redirect URIs must be https or loopback. Registration is open and rate limited by the SDK.
- `authorize` sends the browser to the PWA consent screen (`/oauth/consent`), which reuses the OTP session. Approving issues a one-time code (5 min).
- Tokens are opaque and stored as HMAC with `API_TOKEN_PEPPER`. Access tokens (`zo_`) last 1 hour; refresh tokens (`zr_`) 30 days and rotate. A replayed code or spent refresh token revokes its whole family (`OAuthToken.familyId`).
- `ApiTokenGuard` accepts `zo_` tokens and answers a 401 with `WWW-Authenticate: Bearer resource_metadata=...` so clients can find the server.
- Users list and disconnect assistants in settings (`/oauth/apps`). Personal `zf_` tokens are removed (ADR-0044).
- Models: `OAuthClient`, `OAuthToken`. Env: `PUBLIC_API_URL`.

## Consequences
- ChatGPT Free users need Zenflow listed in the ChatGPT app directory; that submission is manual. Until then they need a paid plan.
- Gemini works for eligible accounts only; the setup screen says so.
- Setup is paste the URL, sign in, allow. No token to copy.
