import { defineMessages, defineLocale } from "okengine";

/**
 * English catalog — default locale registered via `defineLocale`.
 *
 * Domain keys seed extra locales (`create-oke --locales`). Email subject/body
 * live on `mail.template({ catalog })` in `src/core/email.ts`, not here.
 */
export const en = defineMessages({
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
  },
  links: {
    created: "Short link “{code}” was created.",
    archived: "Link archived.",
    empty: "No active links yet.",
    count: "{count, plural, =0 {no links} one {# link} other {# links}}",
    reach: "Reach digest for {day}.",
  },
});

defineLocale("en", en);

declare module "okengine" {
  interface Register {
    messages: typeof en;
  }
}
