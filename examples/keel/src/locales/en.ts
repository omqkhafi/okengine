import { defineMessages, defineLocale } from "okengine";

export const en = defineMessages({
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
    cycleClosed: "That cycle is closed.",
    duplicate: "Already exists.",
    unavailable: "AI service unavailable. Try again later.",
  },
  issues: {
    created: "Issue {identifier} was created.",
    assigned: "Issue {identifier} assigned to {email}.",
    archived: "Issue archived.",
  },
});

defineLocale("en", en);

declare module "okengine" {
  interface Register {
    messages: typeof en;
  }
}
