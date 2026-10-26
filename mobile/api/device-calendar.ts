import { api } from "./base";

/** A busy block as the server takes it: the phone's own times, rounded on the server. */
export interface DeviceBusyBlock {
  externalKey: string;
  title: string;
  start: string;
  end: string;
}

/** Replaces the busy time the server holds for the phone. Fails with 409 while the phone calendar is off. */
export async function putDeviceBusy(blocks: DeviceBusyBlock[]): Promise<void> {
  await api.put("/device-calendar/busy", { blocks });
}
