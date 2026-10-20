import { Inject, Injectable } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import type { LinkPreview } from "@zenflow/shared";
import { parseLinkPreview } from "./html-metadata";
import { FETCH_TIMEOUT_MS, fetchHtmlPage } from "./safe-page-fetch";

const CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class LinkPreviewService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /** Card metadata for a page, or `null` when it has none or cannot be fetched. Only hits are cached. */
  async preview(url: string): Promise<LinkPreview | null> {
    const key = `link-preview:${url}`;
    const cached = await this.cache
      .get<LinkPreview>(key)
      .catch(() => undefined);
    if (cached) return cached;
    const preview = await this.fetchPreview(url);
    if (preview)
      await this.cache.set(key, preview, CACHE_TTL_MS).catch(() => undefined);
    return preview;
  }

  private async fetchPreview(url: string): Promise<LinkPreview | null> {
    try {
      const page = await fetchHtmlPage(
        new URL(url),
        AbortSignal.timeout(FETCH_TIMEOUT_MS),
      );
      if (!page) return null;
      const preview = parseLinkPreview(page.html, page.url.toString());
      return preview.title || preview.image ? preview : null;
    } catch {
      return null;
    }
  }
}
