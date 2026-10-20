import { locale } from "@/lib/i18n";
/** Uploads are classed by file name: images, audio and video render as players, the rest as document cards. */
export const AUDIO_NAME_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
export const VIDEO_NAME_RE = /\.(mp4|m4v|mov|webm|ogv|3gp)$/i;
export const IMAGE_NAME_RE = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;

/** Tile colours for document cards, as on mobile. */
export const DOC_COLORS: Record<string, string> = {
  pdf: "#E5484D",
  doc: "#2F6FEB",
  docx: "#2F6FEB",
  rtf: "#2F6FEB",
  odt: "#2F6FEB",
  xls: "#17A34A",
  xlsx: "#17A34A",
  csv: "#17A34A",
  ods: "#17A34A",
  ppt: "#F76808",
  pptx: "#F76808",
  key: "#F76808",
  zip: "#8B6F47",
  rar: "#8B6F47",
  "7z": "#8B6F47",
  txt: "#6B7280",
  md: "#6B7280",
};

export const DEFAULT_DOC_COLOR = "#8A8178";

export type MediaKind = "audio" | "video" | "image";

export function mediaKind(name: string): MediaKind | null {
  if (AUDIO_NAME_RE.test(name)) return "audio";
  if (VIDEO_NAME_RE.test(name)) return "video";
  if (IMAGE_NAME_RE.test(name)) return "image";
  return null;
}

export function isDataUri(href: string): boolean {
  return href.startsWith("data:");
}

/** A file stored in the note: an inline data URI or an API `/files/:id` link. */
export function isFileHref(href: string): boolean {
  return isDataUri(href) || /\/files\/[^/?#]+/.test(href);
}

export function fileIdFromHref(href: string): string | null {
  const match = /\/files\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(href);
  return match ? match[1] : null;
}

/** Lower-case extension without the dot, or "" when the name has none. */
export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/** Byte size of a base64 data URI. */
export function dataUriBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma < 0) return 0;
  const body = uri.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/** "812 B", "4.2 KB", "13 MB", "1.5 GB": one decimal below 10, none above. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} ${units[0]}`;
  const text =
    value < 10 ? value.toLocaleString(locale(), { maximumFractionDigits: 1 }) : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

/** "0:05", "1:23", "12:04". */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
}

/** Host without `www.`, or the input when it isn't a URL. */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/**
 * The API returns file references as origin-relative `/api/v1/files/:id?sig=…`.
 * Resolve them against the API origin so they load from the web app.
 */
export function resolveNoteFileUrls(html: string, apiBase: string | undefined): string {
  if (!apiBase || !html.includes("/files/")) return html;
  let base: URL;
  try {
    base = new URL(apiBase);
  } catch {
    return html;
  }
  const prefix = `${base.pathname.replace(/\/+$/, "")}/files/`;
  return html.split(`"${prefix}`).join(`"${base.origin}${prefix}`)
    .split(`'${prefix}`).join(`'${base.origin}${prefix}`);
}
