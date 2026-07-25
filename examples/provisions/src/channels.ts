import { channel } from "okengine";
import { z } from "zod";

export const mail = channel.email({ from: "Provisions <no-reply@provisions.sa>" });
export const sms  = channel.sms({ sender: "PROVISIONS" });
export const wa   = channel.whatsapp();

export const orderConfirmed = mail.template("order-confirmed", {
  schema: z.object({ name: z.string(), orderId: z.string(), total: z.number() }),
});

export const otpCode = channel.template("otp-code", {   // medium-agnostic
  schema: z.object({ code: z.string() }),
});
