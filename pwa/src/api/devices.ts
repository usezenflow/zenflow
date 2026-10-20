import type {
  RegisterDeviceResponse,
  UnregisterDeviceInput,
} from "@zenflow/shared";
import { api } from "./base";

/**
 * `POST /devices` body for a browser. `pushToken` is the push subscription
 * endpoint; `p256dh` and `auth` are its base64url keys.
 */
export interface WebDeviceInput {
  platform: "WEB";
  pushToken: string;
  p256dh: string;
  auth: string;
}

export async function registerDevice(
  input: WebDeviceInput,
): Promise<RegisterDeviceResponse> {
  const { data } = await api.post("/devices", input);
  return data.data;
}

export async function unregisterDevice(input: UnregisterDeviceInput): Promise<void> {
  await api.delete("/devices", { data: input });
}
