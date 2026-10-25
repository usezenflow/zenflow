import type {
  ApiSuccess,
  ConnectedAppsResponse,
  OAuthConsentDecisionResponse,
  OAuthConsentInfo,
} from "@zenflow/shared";
import { api } from "./base";

/** Who is asking, for the consent screen. Fails when the request expired. */
export async function getConsent(request: string): Promise<OAuthConsentInfo> {
  const { data } = await api.get<ApiSuccess<OAuthConsentInfo>>("/oauth/consent", {
    params: { request },
  });
  return data.data;
}

/** Records the decision and returns where to send the browser. */
export async function decideConsent(
  request: string,
  approve: boolean,
): Promise<OAuthConsentDecisionResponse> {
  const { data } = await api.post<ApiSuccess<OAuthConsentDecisionResponse>>("/oauth/consent", {
    request,
    approve,
  });
  return data.data;
}

export async function listConnectedApps(): Promise<ConnectedAppsResponse> {
  const { data } = await api.get<ApiSuccess<ConnectedAppsResponse>>("/oauth/apps");
  return data.data;
}

export async function disconnectApp(clientId: string): Promise<ConnectedAppsResponse> {
  const { data } = await api.delete<ApiSuccess<ConnectedAppsResponse>>(
    `/oauth/apps/${encodeURIComponent(clientId)}`,
  );
  return data.data;
}
