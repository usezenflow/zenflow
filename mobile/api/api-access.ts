import type { ApiAccessResponse } from "@zenflow/shared";
import { api } from "./base";

/** The MCP address, the ready-to-paste prompt and the setup steps for AI assistants. */
export async function getApiAccess(): Promise<ApiAccessResponse> {
  const { data } = await api.get("/users/me/api-access");
  return data.data;
}
