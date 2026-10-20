import type { LinkPreview } from "@zenflow/shared";

/** Only the head of the page is parsed; metadata lives there. */
export const HEAD_CHARS = 200_000;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decode(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .trim();
}

/** `<meta property|name="key" content="…">` in either attribute order. */
function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const a = new RegExp(
      `<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`,
      "i",
    ).exec(html);
    const b = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`,
      "i",
    ).exec(html);
    const value = a?.[1] ?? b?.[1];
    if (value?.trim()) return decode(value);
  }
  return null;
}

/** Title, description, image and site name from a page's HTML. Relative images resolve against `pageUrl`. */
export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, HEAD_CHARS);
  const title =
    meta(head, ["og:title", "twitter:title"]) ??
    (() => {
      const m = /<title[^>]*>([^<]*)<\/title>/i.exec(head);
      return m?.[1] ? decode(m[1]) : null;
    })();
  const rawImage = meta(head, [
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ]);
  let image: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        image = resolved.toString();
      }
    } catch {
      image = null;
    }
  }
  return {
    title: title || null,
    description: meta(head, [
      "og:description",
      "twitter:description",
      "description",
    ]),
    image,
    siteName: meta(head, ["og:site_name"]),
  };
}
