import { defineMessages, defineLocale } from "okengine";

export const en = defineMessages({
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
    duplicate: "Already exists.",
    unavailable: "AI service unavailable. Try again later.",
    forbidden: "Your role cannot do that.",
  },
  tasks: {
    created: "Task {identifier} was created.",
    assigned: "Task {identifier} assigned to {email}.",
    completed: "Task completed.",
    archived: "Task archived.",
  },
});

defineLocale("en", en);

declare module "okengine" {
  interface Register {
    messages: typeof en;
  }
}
