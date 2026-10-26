import type {
  ApiAccessResponse,
  ApiSuccess,
} from "@zenflow/shared";
import { api } from "./base";

/** Assistant access: the MCP address, the prompt and the setup steps. */
export async function getApiAccess(): Promise<ApiAccessResponse> {
  const { data } = await api.get<ApiSuccess<ApiAccessResponse>>("/users/me/api-access");
  return data.data;
}
