/**
 * Fixture channels for unit tests and the axe gate.
 */

import type { ChannelsListResponse } from "./types.ts";

/** Sample Channels list (deliverability face). */
export const CHANNELS_LIST_FIXTURE: ChannelsListResponse = {
  face: "deliverability",
  production: true,
  templates: [
    {
      name: "otp-code",
      medium: "any",
      locales: ["en", "ar"],
      from: "noreply@example.com",
      schema: {
        type: "object",
        properties: { code: { type: "string" } },
      },
    },
    {
      name: "booking-confirmed",
      medium: "email",
      locales: ["en"],
      from: "bookings@example.com",
      schema: null,
    },
  ],
  outcomes: [
    {
      state: "delivered-then-complained",
      count: 4,
      verdict: "review",
      weight: 10,
    },
    {
      state: "hard-bounce",
      count: 14,
      verdict: "suppress",
      weight: 5,
    },
    {
      state: "soft-bounce",
      count: 8,
      verdict: "retry",
      weight: 4,
    },
    {
      state: "provider-error",
      count: 2,
      verdict: "retry",
      weight: 4,
    },
    {
      state: "blocked/invalid-address",
      count: 1,
      verdict: "review",
      weight: 3,
    },
    {
      state: "suppressed/prior-bounce",
      count: 6,
      verdict: "correct",
      weight: 1,
    },
    {
      state: "suppressed/opted-out",
      count: 12,
      verdict: "correct",
      weight: 0,
    },
  ],
  fallback: {
    template: null,
    chainExample: "whatsapp failed → sms succeeded",
    fallbackRate: 0.23,
    fallbackCount: 23,
    totalCount: 100,
    weeklyDeltaUsd: 38,
    primaryMedium: "whatsapp",
    fallbackMedium: "sms",
    summary: "23% fell back · $38 / week above whatsapp-only",
  },
  inbox: [
    {
      id: "in-1",
      medium: "sms",
      toMasked: "+966***000",
      subject: null,
      text: "code 1234",
      html: null,
      template: "otp-code",
      locale: "ar",
      at: 1,
    },
  ],
  receipts: [
    {
      id: "r-1",
      template: "otp-code",
      toMasked: "a***@e***.com",
      medium: "any",
      locale: "ar",
      localeChain: ["accept-language:ar", "default:en"],
      status: "fallback",
      chain: "whatsapp failed → sms succeeded",
      messageId: "m-1",
      at: 2,
      error: null,
    },
  ],
  suppression: [
    {
      subjectMasked: "b***@e***.com",
      medium: "email",
      reason: "prior-bounce",
      at: 3,
    },
    {
      subjectMasked: "u***@e***.com",
      medium: "email",
      reason: "opted-out",
      at: 4,
    },
  ],
};

/** Dev-face fixture. */
export const CHANNELS_INBOX_FIXTURE: ChannelsListResponse = {
  ...CHANNELS_LIST_FIXTURE,
  face: "inbox",
  production: false,
};
