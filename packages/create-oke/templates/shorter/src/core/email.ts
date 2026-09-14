/**
 * Shorter Channel email — templates + per-locale bodies.
 *
 * Console locally, Mailpit SMTP in docker. Re-exported from `src/core/index.ts`.
 */

import { channel } from "okengine";
import { z } from "zod";

/** Demo inbox — console locally, Mailpit SMTP in docker. */
const mail = channel.email({ from: "Shorter <shorter@localhost>" });

/** Fired when a link is created (console driver locally · SMTP in docker). */
export const linkCreatedMail = mail.template("link-created", {
  description: "Short URL delivered to the demo inbox",
  locales: ["en"],
  schema: z.object({
    id: z.string(),
    code: z.string(),
    url: z.string(),
    shortUrl: z.string(),
  }),
  catalog: {
    en: {
      subject: "Short link {{code}}",
      text: "{{shortUrl}} → {{url}}",
      html: '<p><a href="{{shortUrl}}">{{code}}</a> → {{url}}</p>',
    },
  },
});

/** Daily Reach digest — yesterday’s clicks grouped by owner. */
export const reachDigestMail = mail.template("reach-digest", {
  description: "Yesterday’s clicks grouped by owner",
  locales: ["en"],
  schema: z.object({
    day: z.string(),
    total: z.number(),
    owners: z.array(
      z.object({
        userId: z.string(),
        clicks: z.number(),
      }),
    ),
  }),
  catalog: {
    en: {
      subject: "Reach digest for {{day}}",
      text: "{{total}} clicks on {{day}}.",
    },
  },
});
