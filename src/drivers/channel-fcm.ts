/**
 * `fcm` channel driver — Firebase Cloud Messaging HTTP v1 via sently.
 */

import { FcmTransport } from "sently/transports/fcm";
import { mapSentlySendError, mapSentlySendResult } from "./channel-sently-map.ts";
import type {
  ChannelDriver,
  ChannelMessage,
  ChannelOpenOptions,
  ChannelSendResult,
  ChannelTransport,
} from "./channel-types.ts";

/**
 * Open an FCM push driver.
 *
 * Prefer service-account credentials (`clientEmail` + `privateKey` + `from`/
 * `projectId`). For tests, pass `token` as a pre-fetched access token via
 * `getAccessToken` (still requires `from` / project id).
 *
 * @param options - Project id + service account or injectable token
 */
export function openFcmChannel(options: ChannelOpenOptions = {}): ChannelDriver {
  const projectId = options.projectId ?? options.from;
  if (!projectId) {
    throw new Error("fcm channel: projectId (or from) is required");
  }

  const clientEmail = options.clientEmail ?? options.user;
  const privateKey = options.privateKey ?? options.pass;
  const accessToken = options.token ?? options.apiKey;

  if (!accessToken && !(clientEmail && privateKey)) {
    throw new Error(
      "fcm channel: clientEmail+privateKey (service account) or token (access token) required",
    );
  }
  if ((clientEmail && !privateKey) || (!clientEmail && privateKey)) {
    throw new Error("fcm channel: clientEmail and privateKey must be provided together");
  }

  // Token-only mode (tests / pre-fetched OAuth): sently still requires placeholder
  // service-account fields; getAccessToken skips JWT exchange.
  const transport = new FcmTransport({
    projectId,
    clientEmail: clientEmail ?? "oke-fcm@local",
    privateKey:
      privateKey ??
      "-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGFw=\n-----END PRIVATE KEY-----\n",
    ...(accessToken ? { getAccessToken: async () => accessToken } : {}),
  });

  const channel: ChannelTransport = {
    provider: "fcm",
    mediums: ["push"],
    async send(message: ChannelMessage): Promise<ChannelSendResult> {
      try {
        const title = message.subject ?? message.template ?? "notification";
        const body = message.text ?? "";
        const result = await transport.send({
          token: message.to,
          title,
          body,
          ...(message.data ? { data: { ...message.data } } : {}),
        });
        return mapSentlySendResult("fcm", result);
      } catch (err) {
        return mapSentlySendError("fcm", err);
      }
    },
    verify: () => transport.verify(),
  };

  return { id: "fcm", channel, pushTransport: transport };
}

/** FCM driver factory. */
export const fcmChannelDriver = {
  id: "fcm" as const,
  open: openFcmChannel,
};
