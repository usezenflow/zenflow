import type {
  ApiAccessResponse,
  ApiSuccess,
  CreateApiTokenInput,
  CreateApiTokenResponse,
  RevokeApiTokenResponse,
} from "@zenflow/shared";
import { api } from "./base";

/** Assistant access: MCP and REST endpoints, the prompt and the token list. */
export async function getApiAccess(): Promise<ApiAccessResponse> {
  const { data } = await api.get<ApiSuccess<ApiAccessResponse>>("/users/me/api-access");
  return data.data;
}

/** The secret is returned only by this response. */
export async function createApiToken(input: CreateApiTokenInput): Promise<CreateApiTokenResponse> {
  const { data } = await api.post<ApiSuccess<CreateApiTokenResponse>>(
    "/users/me/api-access/tokens",
    input,
  );
  return data.data;
}

export async function revokeApiToken(id: string): Promise<RevokeApiTokenResponse> {
  const { data } = await api.delete<ApiSuccess<RevokeApiTokenResponse>>(
    `/users/me/api-access/tokens/${encodeURIComponent(id)}`,
  );
  return data.data;
}

