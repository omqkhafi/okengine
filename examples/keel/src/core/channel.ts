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
  catalog: {
    en: {
      subject: "Assigned: {{identifier}}",
      text: "{{title}} was assigned to {{email}}.",
      html: "<p><strong>{{identifier}}</strong> — {{title}} was assigned to {{email}}.</p>",
    },
  },
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
  catalog: {
    en: {
      subject: "You were mentioned",
      text: "{{body}}",
      html: "<p>{{body}}</p>",
    },
    ar: {
      subject: "تم ذكرك في تعليق",
      text: "{{body}}",
      html: '<p dir="rtl">{{body}}</p>',
    },
  },
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
  catalog: {
    en: {
      subject: "Overdue: {{identifier}}",
      text: "{{title}} is overdue.",
      html: "<p><strong>{{identifier}}</strong> — {{title}} is overdue.</p>",
    },
  },
});

/** Morning inbox + goal digest. */
export const dailyDigestMail = mail.template("daily-digest", {
  locales: ["en", "ar"],
  description: "Morning inbox + goal digest",
  schema: z.object({
    open: z.number(),
    at: z.iso.datetime(),
  }),
  catalog: {
    en: {
      subject: "Daily digest",
      text: "{{open}} open tasks ({{at}}).",
      html: "<p>{{open}} open tasks as of {{at}}.</p>",
    },
    ar: {
      subject: "الملخص اليومي",
      text: "{{open}} مهام مفتوحة ({{at}}).",
      html: '<p dir="rtl">{{open}} مهام مفتوحة حتى {{at}}.</p>',
    },
  },
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
  catalog: {
    en: {
      subject: "Form received: {{customerName}}",
      text: "Form {{formId}} created task {{taskId}}.",
      html: "<p>Form {{formId}} created task {{taskId}} for {{customerName}}.</p>",
    },
  },
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
  catalog: {
    en: {
      subject: "Goal at risk: {{name}}",
      text: "{{name}} is {{status}}.",
      html: "<p><strong>{{name}}</strong> is {{status}}.</p>",
    },
  },
});
