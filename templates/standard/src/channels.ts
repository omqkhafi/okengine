import { channel } from "okengine";
import { z } from "zod";

export const mail = channel.email({ from: "App <no-reply@example.com>" });

/** Dev inbox notice — lands in the console channel driver on every ping. */
export const pingNotice = mail.template("ping-notice", {
  schema: z.object({ id: z.string(), note: z.string() }),
});
