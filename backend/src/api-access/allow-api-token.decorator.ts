import { SetMetadata } from "@nestjs/common";

export const API_TOKEN_ROUTE_KEY = "apiTokenRoute";

/** Lets `Authorization: Bearer zf_...` reach this route. Other routes answer 403. */
export const AllowApiToken = () => SetMetadata(API_TOKEN_ROUTE_KEY, "allow");

/** Bearer only: a cookie session is refused on this route. */
export const ApiTokenOnly = () => SetMetadata(API_TOKEN_ROUTE_KEY, "only");

export const OAUTH_ROUTE_KEY = "oauthRoute";

/** Lets an OAuth access token from the MCP sign-in reach this route. Other routes refuse them. */
export const AllowOAuth = () => SetMetadata(OAUTH_ROUTE_KEY, true);
