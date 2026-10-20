import { useEffect, useState, useSyncExternalStore } from "react";
import type { LinkPreview } from "@/api/notes";
import { fetchLinkPreview } from "@/lib/notes/link-preview";
import { fileSize } from "@/lib/notes/file-size";
import { dataUriBytes, isDataUri } from "@/lib/notes/media";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Bytes of a note file, or `null` until known. */
export function useFileSize(href: string): number | null {
  const [remote, setRemote] = useState<{ href: string; bytes: number | null } | null>(
    null,
  );
  useEffect(() => {
    if (isDataUri(href)) return;
    let alive = true;
    void fileSize(href).then((bytes) => {
      if (alive) setRemote({ href, bytes });
    });
    return () => {
      alive = false;
    };
  }, [href]);
  if (isDataUri(href)) return dataUriBytes(href);
  return remote?.href === href ? remote.bytes : null;
}

/** Link metadata, or `undefined` while it is still loading. */
export function useLinkPreview(url: string): LinkPreview | null | undefined {
  const [result, setResult] = useState<{ url: string; preview: LinkPreview | null } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    void fetchLinkPreview(url).then((preview) => {
      if (alive) setResult({ url, preview });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return result?.url === url ? result.preview : undefined;
}
