import { on, flow } from "okengine";
import { z } from "zod";
import { orderNews } from "../orders/signals";
import { getOrder } from "../orders";
import { orderConfirmed, otpCode, wa, sms } from "../../channels";

on(
  orderNews,
  flow({
    do: async ({ orderId, status }, fx) => {
      if (status !== "confirmed") return;
      const o = await fx.call(getOrder, { id: orderId });
      await fx.send(orderConfirmed, {
        to: o.userId,
        data: { name: o.userName, orderId, total: o.total },
      });
    },
  }),
);

export const sendOtp = flow({
  in: z.object({ userId: z.string(), code: z.string() }),
  do: ({ userId, code }, fx) => fx.send(otpCode, { to: userId, via: [wa, sms], data: { code } }),
  //                                                     ↑ fallback chain: WhatsApp, else SMS
});
