import type { SpiritHatchResponse, SpiritsResponse } from "@zenflow/shared";
import { api } from "./base";

/** The signed-in user's egg, collection, power and perks. */
export async function getSpirits(): Promise<SpiritsResponse> {
  const { data } = await api.get("/spirits");
  return data.data;
}

/** Hatches a ready egg. Returns the spirit rolled and the next egg. */
export async function hatchEgg(id: string): Promise<SpiritHatchResponse> {
  const { data } = await api.post(`/eggs/${id}/hatch`);
  return data.data;
}
