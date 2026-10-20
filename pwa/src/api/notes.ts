import type { ApiSuccess } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { api } from "./base";

/** Page metadata for a link card. Served by `GET /link-preview`; not in `@zenflow/shared` yet. */
export interface LinkPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** `null` when the page has no metadata (404) or the response has none. Other failures throw. */
export async function getLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const { data } = await api.get<ApiSuccess<LinkPreview | null>>(
      "/link-preview",
      { params: { url } },
    );
    return data.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

export async function getFileSize(id: string): Promise<number> {
  const { data } = await api.get<ApiSuccess<{ size: number }>>(
    `/files/metadata/${id}`,
  );
  return data.data.size;
}

export async function getFileBlob(id: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/files/${id}`, {
    responseType: "blob",
  });
  return data;
}
