import { Injectable } from "@nestjs/common";
import type { RequestHandler } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { MCP_SCOPE, OAuthConfig } from "./oauth.config";
import { OAuthProvider } from "./oauth.provider";

/**
 * Express router for discovery, dynamic registration, authorize, token and
 * revoke. It must sit at the application root, so `main.ts` mounts it.
 */
@Injectable()
export class OAuthRouter {
  constructor(
    private readonly config: OAuthConfig,
    private readonly provider: OAuthProvider,
  ) {}

  create(): RequestHandler {
    return mcpAuthRouter({
      provider: this.provider,
      issuerUrl: this.config.issuer,
      resourceServerUrl: this.config.mcpUrl,
      scopesSupported: [MCP_SCOPE],
      resourceName: "Zenflow",
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    });
  }
}
