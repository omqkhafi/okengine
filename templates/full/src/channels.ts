import { channel } from "okengine";
import { z } from "zod";

export const mail = channel.email({ from: "App <no-reply@example.com>" });

/** Stub channel template — replace with real copy. */
export const welcome = mail.template("welcome", {
  schema: z.object({ name: z.string() }),
});
