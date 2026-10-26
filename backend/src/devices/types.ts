import type { PushDataPayload, PushTone } from "@zenflow/shared";

/** A push, ready for {@link NtfySender} to publish. */
export interface PushMessage {
  title: string;
  body: string;
  data: PushDataPayload;
  tone: PushTone;
}

/** What the sender hands back so {@link PushService} can log + prune. */
export interface SendResult {
  /** How many of the given topics ntfy accepted. */
  sent: number;
  /** Topics that can never be published to (malformed): safe to delete. */
  invalidTokens: string[];
}
