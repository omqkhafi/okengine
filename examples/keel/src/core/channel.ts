/**
 * Keel channel templates.
 */

import { channel } from "okengine";
import { z } from "zod";

const mail = channel.email({ from: "Keel <keel@localhost>" });

/** Assignee notification. */
export const taskAssignedMail = mail.template("task-assigned", {
  locales: ["en"],
  description: "Assignee notification",
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    email: z.string(),
  }),
});

/** Comment mention reply. */
export const mentionReplyMail = mail.template("mention-reply", {
  locales: ["en", "ar"],
  description: "Comment mention reply",
  schema: z.object({
    id: z.string(),
    taskId: z.string(),
    body: z.string(),
  }),
});

/** Overdue task. */
export const taskOverdueMail = mail.template("task-overdue", {
  locales: ["en"],
  description: "Overdue task",
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
  }),
});

/** Morning inbox + goal digest. */
export const dailyDigestMail = mail.template("daily-digest", {
  locales: ["en", "ar"],
  description: "Morning inbox + goal digest",
  schema: z.object({
    open: z.number(),
    at: z.number(),
  }),
});

/** Form intake received. */
export const formReceivedMail = mail.template("form-received", {
  locales: ["en"],
  description: "Form intake received",
  schema: z.object({
    formId: z.string(),
    taskId: z.string(),
    customerName: z.string(),
  }),
});

/** Goal health at risk. */
export const goalAtRiskMail = mail.template("goal-at-risk", {
  locales: ["en"],
  description: "Goal health at risk",
  schema: z.object({
    goalId: z.string(),
    name: z.string(),
    status: z.string(),
  }),
});
