import { channel } from "okengine";
import { z } from "zod";

const mail = channel.email({ from: "Notes <notes@localhost>" });

/** Email when a note is created (console driver locally · SMTP in docker). */
export const noteCreatedMail = mail.template("note-created", {
  locales: ["en", "ar"],
  schema: z.object({
    id: z.string(),
    title: z.string(),
  }),
});
