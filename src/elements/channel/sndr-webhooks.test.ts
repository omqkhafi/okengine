/**
 * SNDR webhook helpers re-exported from sently.
 */

import { describe, expect, test } from "bun:test";
import { parseSndrWebhook } from "./mime.ts";

describe("parseSndrWebhook", () => {
  test("normalizes a delivery event payload", () => {
    const events = parseSndrWebhook({
      type: "email.delivered",
      data: {
        email_id: "em_test",
        to: ["user@example.com"],
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        provider: "sndr",
        type: "delivered",
        messageId: "em_test",
        recipient: "user@example.com",
      }),
    ]);
  });
});
