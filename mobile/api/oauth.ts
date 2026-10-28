import type {
  ConnectedAppsResponse,
  OAuthConsentDecisionInput,
  OAuthConsentDecisionResponse,
  OAuthConsentInfo,
} from "@zenflow/shared";
import { api } from "./base";

export async function listConnectedApps(): Promise<ConnectedAppsResponse> {
  const { data } = await api.get("/oauth/apps");
  return data.data;
}

export async function disconnectApp(clientId: string): Promise<ConnectedAppsResponse> {
  const { data } = await api.delete(`/oauth/apps/${encodeURIComponent(clientId)}`);
  return data.data;
}

/** Who is asking, for the code an assistant's page shows. Fails when the code is wrong or expired. */
export async function getConsent(code: string): Promise<OAuthConsentInfo> {
  const { data } = await api.get("/oauth/consent", { params: { code } });
  return data.data;
}

/** Approves or refuses. The assistant's browser page moves on by itself. */
export async function decideConsent(code: string, approve: boolean): Promise<OAuthConsentDecisionResponse> {
  const { data } = await api.post("/oauth/consent", { code, approve } satisfies OAuthConsentDecisionInput);
  return data.data;
}
