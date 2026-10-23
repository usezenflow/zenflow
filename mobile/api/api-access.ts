import type {
  ApiAccessResponse,
  CreateApiTokenResponse,
  RevokeApiTokenResponse,
} from "@zenflow/shared";
import { api } from "./base";

/** Endpoints, the ready-to-paste prompt and the token list for AI assistants. */
export async function getApiAccess(): Promise<ApiAccessResponse> {
  const { data } = await api.get("/users/me/api-access");
  return data.data;
}

/** The returned `secret` is the only copy; it is never read back. */
export async function createApiToken(
  name: string,
): Promise<CreateApiTokenResponse> {
  const { data } = await api.post("/users/me/api-access/tokens", { name });
  return data.data;
}

/** Revokes at once; assistants using the token lose access. */
export async function revokeApiToken(
  id: string,
): Promise<RevokeApiTokenResponse> {
  const { data } = await api.delete(
    `/users/me/api-access/tokens/${encodeURIComponent(id)}`,
  );
  return data.data;
}
