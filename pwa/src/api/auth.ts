import { clearOfflineCache } from "@/lib/offline/cache";
import { User } from "@/types/user";
import type { Lang } from "@zenflow/shared";
import { api } from "./base";

/** Sends a sign-in code, in the given language for the email copy. */
export async function requestOtp(email: string, lang?: Lang) {
  const { data } = await api.post("/auth/otp/request", { email, lang });
  return data;
}

export async function verifyOtp(email: string, otp: string) {
  const { data } = await api.post(
    "/auth/otp/verify",
    { email, otp },
    {
      headers: {
        "x-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  );
  return data;
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    await clearOfflineCache();
  }
}

export async function me(): Promise<User | null> {
  const { data } = await api.get("/auth/me");
  return data.data;
}
