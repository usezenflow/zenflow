import { getFileSize } from "@/api/notes";
import { dataUriBytes, fileIdFromHref, isDataUri } from "./media";

const cache = new Map<string, Promise<number | null>>();

/** Size in bytes of a note file. Data URIs are measured locally; API files are looked up once. */
export function fileSize(href: string): Promise<number | null> {
  if (isDataUri(href)) return Promise.resolve(dataUriBytes(href));
  const id = fileIdFromHref(href);
  if (!id) return Promise.resolve(null);
  let hit = cache.get(id);
  if (!hit) {
    hit = getFileSize(id).catch(() => null);
    cache.set(id, hit);
  }
  return hit;
}
