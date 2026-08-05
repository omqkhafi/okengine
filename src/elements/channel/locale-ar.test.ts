/**
 * Arabic / RTL catalog round-trip proofs:
 * - {{field}} interpolation inside Arabic bodies
 * - ar vs ar-SA exact catalog key behavior
 * - isRtlLocale for display (Channel does not rewrite HTML dir)
 */

import { describe, expect, test } from "bun:test";
import { createChannelInbox, openConsoleChannel } from "../../drivers/index.ts";
import { channel, createChannelRuntime, isRtlLocale } from "../channel.ts";

describe("Arabic template catalog", () => {
  test("interpolates variables inside Arabic subject and text", async () => {
    const inbox = createChannelInbox();
    const runtime = createChannelRuntime({
      templates: [
        channel.template("order-confirmed", {
          medium: "email",
          locales: ["en", "ar"],
        }),
      ],
      drivers: [openConsoleChannel({ inbox })],
      catalog: {
        "order-confirmed": {
          en: {
            subject: "Order {{orderId}}",
            text: "Hello {{name}}, order {{orderId}} is confirmed.",
          },
          ar: {
            subject: "طلب {{orderId}}",
            text: "مرحبًا {{name}}، تم تأكيد الطلب {{orderId}}.",
          },
        },
      },
    });

    await runtime.send("order-confirmed", {
      to: "user@example.com",
      locale: "ar",
      data: { name: "علي", orderId: "ORD-42" },
    });

    const entry = inbox.entries[0]!;
    expect(entry.subject).toBe("طلب ORD-42");
    expect(entry.text).toBe("مرحبًا علي، تم تأكيد الطلب ORD-42.");
    expect(entry.subject).not.toContain("{{");
    expect(entry.text).not.toContain("{{");
    // Email console inbox omits locale; the receipt is the ledger of truth.
    expect(runtime.receipts.all()[0]!.locale).toBe("ar");
  });

  test("Accept-Language ar-SA misses catalog key ar and falls back to default/en body", async () => {
    const inbox = createChannelInbox();
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email", locales: ["en", "ar"] })],
      drivers: [openConsoleChannel({ inbox })],
      defaultLocale: "en",
      catalog: {
        hello: {
          en: { subject: "Hi {{name}}", text: "Hello {{name}}" },
          ar: { subject: "مرحبا {{name}}", text: "أهلا {{name}}" },
        },
      },
    });

    await runtime.send("hello", {
      to: "a@b.c",
      acceptLanguage: "ar-SA,en;q=0.8",
      data: { name: "سارة" },
    });

    const receipt = runtime.receipts.all()[0]!;
    expect(receipt.locale).toBe("ar-SA");
    // Exact key miss → defaultLocale "en" body with interpolation still applied
    expect(inbox.entries[0]!.subject).toBe("Hi سارة");
    expect(inbox.entries[0]!.text).toBe("Hello سارة");
  });

  test("exact ar catalog key selects Arabic when locale is ar", async () => {
    const inbox = createChannelInbox();
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email" })],
      drivers: [openConsoleChannel({ inbox })],
      catalog: {
        hello: {
          en: { subject: "Hi", text: "Hello" },
          ar: { subject: "مرحبا {{name}}", text: "أهلا {{name}}" },
        },
      },
    });

    await runtime.send("hello", { to: "a@b.c", locale: "ar", data: { name: "نورة" } });
    expect(inbox.entries[0]!.subject).toBe("مرحبا نورة");
    expect(inbox.entries[0]!.text).toBe("أهلا نورة");
  });

  test("isRtlLocale marks Arabic (and ar-SA) as RTL for display helpers", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("ar-SA")).toBe(true);
    expect(isRtlLocale("en")).toBe(false);
  });
});
