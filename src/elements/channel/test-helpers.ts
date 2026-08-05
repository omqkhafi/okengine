/**
 * Shared fakes for Channel adversarial tests.
 */

import type { MailOptions, SendResult, Transport } from "sently";
import type { ChannelDriver } from "../../drivers/channel-types.ts";

/** Flatten a sently address field for fake SendResult envelopes. */
export function addressToString(input: MailOptions["to"]): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return "batch";
  return input.address;
}

/** Create a sently-compatible transport that always fails with `error`. */
export function failingTransport(
  provider: string,
  error: unknown = new Error(`${provider} down`),
): Transport {
  return {
    provider,
    async send(_options: MailOptions): Promise<SendResult> {
      throw error;
    },
  };
}

/** Create a sently-compatible transport that succeeds. */
export function okTransport(provider: string, calls?: { count: number }): Transport {
  return {
    provider,
    async send(options: MailOptions): Promise<SendResult> {
      if (calls) calls.count += 1;
      const to = addressToString(options.to);
      const from = addressToString(options.from);
      return {
        messageId: `${provider}-msg`,
        accepted: [to],
        rejected: [],
        response: "ok",
        envelope: { from, to: [to] },
        provider,
      };
    },
  };
}

/** Counting success transport — proves a send actually hit the wire. */
export function countingOkTransport(provider: string): {
  transport: Transport;
  calls: { count: number };
} {
  const calls = { count: 0 };
  return { transport: okTransport(provider, calls), calls };
}

/** Wrap a Transport as a ChannelDriver. */
export function driverFromTransport(id: ChannelDriver["id"], transport: Transport): ChannelDriver {
  return { id, transport };
}
