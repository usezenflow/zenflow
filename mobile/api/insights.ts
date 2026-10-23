import type { InsightsResponse } from "@zenflow/shared";
import { api } from "./base";

/** Focus map, weekly recap and buffers over a `YYYY-MM-DD` window in the user's timezone. */
export async function getInsights(
  from: string,
  to: string,
): Promise<InsightsResponse> {
  const { data } = await api.get("/users/me/insights", {
    params: { from, to },
  });
  return data.data;
}
