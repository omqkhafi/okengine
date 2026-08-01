import { describe, expect, test } from "bun:test";
import { clearMessageFormatCache, formatMessage } from "./format.ts";
import {
  clearMessageCatalogs,
  defineLocale,
  defineMessages,
  flattenMessages,
  getMessageCatalogs,
  matchConfiguredLocale,
  translate,
} from "./messages.ts";
import type { FlattenKeys, MessagesFor } from "./types.ts";

describe("flattenMessages", () => {
  test("flattens nested trees with dot keys", () => {
    expect(
      flattenMessages({
        errors: { notFound: "Missing" },
        hello: "Hi",
      }),
    ).toEqual({
      "errors.notFound": "Missing",
      hello: "Hi",
    });
  });
});

describe("defineLocale / getMessageCatalogs", () => {
  test("registers overlays that win over built-ins", () => {
    clearMessageCatalogs();
    defineLocale("en", { greeting: "Hello, {name}" });
    defineLocale("ar", { greeting: "مرحباً، {name}" });
    const catalogs = getMessageCatalogs();
    expect(catalogs.en?.greeting).toBe("Hello, {name}");
    expect(catalogs.ar?.greeting).toBe("مرحباً، {name}");
    // Built-ins remain available under the same locale.
    expect(catalogs.en?.["errors.Unauthorized"]).toBe("Authentication required.");
    defineLocale("en", { greeting: "Hi, {name}" });
    expect(getMessageCatalogs().en?.greeting).toBe("Hi, {name}");
    clearMessageCatalogs();
  });
});

describe("formatMessage — ICU", () => {
  test("interpolates simple placeholders", () => {
    clearMessageFormatCache();
    expect(formatMessage("Hello, {name}", "en", { name: "Ada" })).toBe("Hello, Ada");
  });

  test("cardinal plurals", () => {
    clearMessageFormatCache();
    const msg = "{count, plural, =0 {no items} one {# item} other {# items}}";
    expect(formatMessage(msg, "en", { count: 0 })).toBe("no items");
    expect(formatMessage(msg, "en", { count: 1 })).toBe("1 item");
    expect(formatMessage(msg, "en", { count: 5 })).toBe("5 items");
  });

  test("ordinal plurals via selectordinal", () => {
    clearMessageFormatCache();
    const msg = "You finished {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}!";
    expect(formatMessage(msg, "en", { place: 1 })).toBe("You finished 1st!");
    expect(formatMessage(msg, "en", { place: 2 })).toBe("You finished 2nd!");
    expect(formatMessage(msg, "en", { place: 3 })).toBe("You finished 3rd!");
    expect(formatMessage(msg, "en", { place: 11 })).toBe("You finished 11th!");
  });

  test("enum select", () => {
    clearMessageFormatCache();
    const msg = "{status, select, online {Online} offline {Offline} other {Unknown}}";
    expect(formatMessage(msg, "en", { status: "online" })).toBe("Online");
    expect(formatMessage(msg, "en", { status: "offline" })).toBe("Offline");
    expect(formatMessage(msg, "en", { status: "away" })).toBe("Unknown");
  });

  test("rich text tags via function values", () => {
    clearMessageFormatCache();
    const msg = "Read <docs>the docs</docs>.";
    expect(
      formatMessage(msg, "en", {
        docs: (chunks) => `[${chunks.join("")}]`,
      }),
    ).toBe("Read [the docs].");
  });

  test("Arabic plural sample", () => {
    clearMessageFormatCache();
    const msg =
      "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصراً} other {# عنصر}}";
    expect(formatMessage(msg, "ar", { count: 0 })).toBe("لا عناصر");
    expect(formatMessage(msg, "ar", { count: 1 })).toBe("عنصر واحد");
    expect(formatMessage(msg, "ar", { count: 2 })).toBe("عنصران");
  });
});

describe("translate", () => {
  const catalogs = {
    en: {
      "errors.notFound": "Not found",
      greeting: "Hello, {name}",
      items: "{count, plural, one {# item} other {# items}}",
    },
    ar: {
      greeting: "مرحباً، {name}",
    },
  };

  test("uses locale, then default, then key", () => {
    expect(
      translate({
        locale: "ar",
        defaultLocale: "en",
        catalogs,
        key: "greeting",
        values: { name: "Ada" },
      }),
    ).toBe("مرحباً، Ada");
    expect(
      translate({
        locale: "ar",
        defaultLocale: "en",
        catalogs,
        key: "errors.notFound",
      }),
    ).toBe("Not found");
    expect(
      translate({
        locale: "en",
        defaultLocale: "en",
        catalogs,
        key: "items",
        values: { count: 3 },
      }),
    ).toBe("3 items");
    expect(
      translate({
        locale: "ar",
        defaultLocale: "en",
        catalogs,
        key: "missing",
        values: { x: 1 },
      }),
    ).toBe('missing:{"x":1}');
  });
});

describe("matchConfiguredLocale", () => {
  test("matches exact, base tag, then default", () => {
    const locales = ["en", "ar"] as const;
    expect(matchConfiguredLocale("ar", locales, "en")).toBe("ar");
    expect(matchConfiguredLocale("ar-SA", locales, "en")).toBe("ar");
    expect(matchConfiguredLocale("fr", locales, "en")).toBe("en");
    expect(matchConfiguredLocale(undefined, locales, "en")).toBe("en");
  });
});

describe("type helpers (compile-time shapes)", () => {
  test("defineMessages preserves tree; MessagesFor aligns locales", () => {
    const en = defineMessages({
      errors: { notFound: "Not found" },
      greeting: "Hello, {name}",
    });
    const ar = {
      errors: { notFound: "غير موجود" },
      greeting: "مرحباً، {name}",
    } satisfies MessagesFor<typeof en>;

    type Keys = FlattenKeys<typeof en>;
    const key: Keys = "errors.notFound";
    expect(en.errors.notFound).toBe("Not found");
    expect(ar.greeting).toContain("{name}");
    expect(key).toBe("errors.notFound");
  });
});
