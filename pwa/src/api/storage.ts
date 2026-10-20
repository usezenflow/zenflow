import type { FileUsage } from "@zenflow/shared";
import { api } from "./base";

/** Effective upload limits plus the signed-in user's stored bytes. */
export async function getFileUsage(): Promise<FileUsage> {
  const { data } = await api.get("/files/usage");
  return data.data;
}
