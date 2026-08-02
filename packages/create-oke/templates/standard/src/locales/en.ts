import { defineMessages, defineLocale } from "okengine";

export const en = defineMessages({
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
  },
  notes: {
    created: "Note “{title}” was created.",
    archived: "Note archived.",
    empty: "No active notes yet.",
    count: "{count, plural, =0 {no notes} one {# note} other {# notes}}",
  },
});

defineLocale("en", en);

declare module "okengine" {
  interface Register {
    messages: typeof en;
  }
}
