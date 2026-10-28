import type { UpdateUserInput, User } from "@zenflow/shared";
import { api } from "./base";

/** The current user's full record, including preferences. */
export async function getMe(): Promise<User> {
  const { data } = await api.get("/users/me");
  return data.data;
}

// No `completeOnboarding`/`updatePreferences` — there is no onboarding flow
// and no user-editable preferences anymore. Timezone is captured once at OTP
// signup via the `x-timezone` header (see `api/auth.ts`) and isn't editable
// after that.

export async function updateBasicInfo(input: UpdateUserInput): Promise<User> {
  const { data } = await api.patch("/users/update/basic-info", input);
  return data.data;
}

/** Server copy of the palette blob and its ETag; null when the user has none. */
export async function getPalette(): Promise<{ bytes: Uint8Array; etag: string } | null> {
  const res = await api.get("/users/me/palette", { responseType: "arraybuffer" });
  if (res.status === 204) return null;
  return { bytes: new Uint8Array(res.data), etag: String(res.headers.etag) };
}

/** Replaces the blob if `etag` is still current ("0" for none); a 412 means refetch and merge. */
export async function putPalette(bytes: Uint8Array, etag: string): Promise<string> {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const res = await api.put("/users/me/palette", body, {
    headers: { "Content-Type": "application/octet-stream", "If-Match": etag },
    transformRequest: [(d) => d],
  });
  return String(res.headers.etag);
}
