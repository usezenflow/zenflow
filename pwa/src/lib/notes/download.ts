import { getFileBlob } from "@/api/notes";
import { fileIdFromHref, isDataUri } from "./media";

/**
 * Saves a note file. API files are fetched through the authenticated client:
 * a plain link can't carry the session cookie across sites.
 */
export async function downloadNoteFile(href: string, name: string): Promise<void> {
  const id = isDataUri(href) ? null : fileIdFromHref(href);
  const url = id ? URL.createObjectURL(await getFileBlob(id)) : href;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  if (id) setTimeout(() => URL.revokeObjectURL(url), 1000);
}
