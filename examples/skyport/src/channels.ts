import { channel } from "okengine";
import { z } from "zod";

export const mail = channel.email({ from: "Skyport <no-reply@skyport.sa>" });

export const bookingConfirmed = mail.template("booking-confirmed", {
  schema: z.object({
    name: z.string(),
    bookingId: z.string(),
  }),
  locales: ["en", "ar"],
});
