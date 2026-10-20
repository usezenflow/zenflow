import { type LinkPreview, getLinkPreview } from "@/api/notes";

const cache = new Map<string, Promise<LinkPreview | null>>();

/**
 * Metadata for a link card, fetched through our API (browsers can't fetch other
 * origins). Cached per URL. Resolves to `null` when the page has none; a failed
 * call is not cached, so the next card retries.
 */
export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(null);
  let hit = cache.get(url);
  if (!hit) {
    hit = getLinkPreview(url).catch(() => {
      cache.delete(url);
      return null;
    });
    cache.set(url, hit);
  }
  return hit;
}
