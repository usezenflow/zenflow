/** `data` payload for `GET /oauth/consent`. */
export interface OAuthConsentInfo {
  clientName: string;
  scopes: string[];
}

/** Body of `POST /oauth/consent`. */
export interface OAuthConsentDecisionInput {
  request: string;
  approve: boolean;
}

/** `data` payload for `POST /oauth/consent`: where to send the browser next. */
export interface OAuthConsentDecisionResponse {
  redirectUrl: string;
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
