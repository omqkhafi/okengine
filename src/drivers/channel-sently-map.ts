/**
 * Map sently channel send results into OKE {@link ChannelSendResult}.
 */

import { toChannelSendResult, type AnySendResult } from "sently/channel-result";
import type { ChannelSendResult } from "./channel-types.ts";

/**
 * Convert a sently email/SMS/WhatsApp/push result into an OKE channel result.
 *
 * @param driverId - OKE driver id fallback when provider is missing
 * @param result - Sently channel-specific send result
 * @param at - Attempt timestamp
 */
export function mapSentlySendResult(
  driverId: string,
  result: AnySendResult,
  at: number = Date.now(),
): ChannelSendResult {
  const normalized = toChannelSendResult(result);
  const id = normalized.provider ?? driverId;
  return {
    ok: normalized.accepted,
    messageId: normalized.messageId || crypto.randomUUID(),
    driverId: id,
    attempts: [
      {
        driverId: id,
        ok: normalized.accepted,
        at,
        ...(normalized.messageId ? { messageId: normalized.messageId } : {}),
      },
    ],
  };
}

/**
 * Build a failed OKE channel result from a thrown error.
 *
 * @param driverId - Driver id
 * @param err - Error
 * @param at - Timestamp
 */
export function mapSentlySendError(
  driverId: string,
  err: unknown,
  at: number = Date.now(),
): ChannelSendResult {
  const error = err instanceof Error ? err.message : String(err);
  const id = crypto.randomUUID();
  return {
    ok: false,
    messageId: id,
    driverId,
    attempts: [{ driverId, ok: false, error, at }],
  };
}
