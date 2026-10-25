/**
 * AI assistant access (MCP and REST). Assistants sign in through OAuth; scripts
 * can use a personal token, shown once, stored only as an HMAC and sent as
 * `Authorization: Bearer zf_...`.
 */

export interface ApiTokenSummary {
  id: string;
  /** User-given label, e.g. "ChatGPT". */
  name: string;
  createdAt: string;
  /** ISO instant of the last authenticated request, or `null` if never used. */
  lastUsedAt: string | null;
}

/** One provider tab in the setup guide. `code` is an optional snippet to copy. */
export interface AssistantSetupGuide {
  id: string;
  /** Tab label, e.g. "ChatGPT". */
  label: string;
  /** Opens the assistant's own settings page for adding the connection. */
  link?: { label: string; url: string };
  steps: string[];
  code?: string;
}

/** `GET /users/me/api-access`. */
export interface ApiAccessResponse {
  /** Streamable HTTP MCP endpoint, e.g. `https://…/api/v1/mcp`. */
  mcpUrl: string;
  /** REST base for platforms without MCP support, e.g. `https://…/api/v1`. */
  restBaseUrl: string;
  /** Ready-to-paste system prompt that tells the assistant which tools exist. */
  prompt: string;
  /** Per-provider connection steps, one tab each. */
  setup: AssistantSetupGuide[];
  tokens: ApiTokenSummary[];
}

/** `POST /users/me/api-access/tokens`. `secret` is returned only in this response. */
export interface CreateApiTokenInput {
  name: string;
}

export interface CreateApiTokenResponse {
  token: ApiTokenSummary;
  secret: string;
}

/** `DELETE /users/me/api-access/tokens/:id`. Revokes at once. */
export interface RevokeApiTokenResponse {
  revoked: true;
}
