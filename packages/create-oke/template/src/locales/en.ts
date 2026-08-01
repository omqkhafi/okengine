import { defineMessages, defineLocale } from "okengine";

/**
 * English message catalog — ICU MessageFormat strings for `fx.t("…")`.
 * Nested objects flatten to dot keys (`errors.notFound`).
 *
 * Augment `Register` so `fx.t` autocompletes keys and rejects typos.
 */
export const en = defineMessages({
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
  },
  greeting: "Hello, {name}",
  items: "{count, plural, =0 {no items} one {# item} other {# items}}",
  place: "You finished {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}!",
  status: "{status, select, online {Online} offline {Offline} other {Unknown}}",
});

defineLocale("en", en);

declare module "okengine" {
  interface Register {
    messages: typeof en;
  }
}
