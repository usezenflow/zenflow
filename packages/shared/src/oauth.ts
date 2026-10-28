/** `data` payload for `GET /oauth/consent?code=`. */
export interface OAuthConsentInfo {
  clientName: string;
  /** Host the browser is sent back to, so the user can see where the access goes. */
  redirectHost: string;
  scopes: string[];
}

/** Body of `POST /oauth/consent`. `code` is the one the assistant's browser page shows. */
export interface OAuthConsentDecisionInput {
  code: string;
  approve: boolean;
}

/** `data` payload for `POST /oauth/consent`. The browser page moves on by itself. */
export interface OAuthConsentDecisionResponse {
  approved: boolean;
}

/** An AI assistant the user has connected through OAuth. */
export interface ConnectedApp {
  clientId: string;
  name: string;
  /** ISO-8601 instant of the first connection. */
  connectedAt: string;
}

/** `data` payload for `GET /oauth/apps`. */
export interface ConnectedAppsResponse {
  apps: ConnectedApp[];
}
