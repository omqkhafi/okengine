import { defineMessages, defineLocale } from "okengine";

/**
 * English catalog — default locale registered via `defineLocale`.
 * Extra locales (`create-oke --locales`) copy this key shape.
 */
export const en = defineMessages({
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
  },
});

defineLocale("en", en);

declare module "okengine" {
  interface Register {
    messages: typeof en;
  }
}
