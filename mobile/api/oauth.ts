import type { ConnectedAppsResponse } from "@zenflow/shared";
import { api } from "./base";

export async function listConnectedApps(): Promise<ConnectedAppsResponse> {
  const { data } = await api.get("/oauth/apps");
  return data.data;
}
