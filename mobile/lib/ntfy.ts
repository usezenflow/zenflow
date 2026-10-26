export const NTFY_STORE_URL = {
  ios: "https://apps.apple.com/app/ntfy/id1625396347",
  android: "https://play.google.com/store/apps/details?id=io.heckel.ntfy",
} as const;

/** Unguessable topic: the topic name is the only secret of a ntfy subscription. */
export function topicFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error("topic needs at least 16 random bytes");
  return `zf-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Deep link that makes the ntfy app subscribe to `topic` on the server at `baseUrl`. */
export function ntfySubscribeUrl(baseUrl: string, topic: string): string {
  const host = baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `ntfy://subscribe/${host}/${topic}`;
}
