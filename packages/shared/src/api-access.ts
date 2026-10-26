/**
 * AI assistant access (MCP). Assistants sign in with the user's Zenflow
 * account through OAuth; nothing secret is copied.
 */

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
  /** Ready-to-paste system prompt; assistants also get it as the server instructions. */
  prompt: string;
  /** Per-provider connection steps, one tab each. */
  setup: AssistantSetupGuide[];
}
