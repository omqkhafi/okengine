import { stripe } from "./stripe";
import { eq } from "drizzle-orm";
import { orderNews } from "../orders/signals";
import { db } from "../../core";
import { orders } from "../../schema";

import { flow } from "okengine";
import { z } from "zod";
import { stripeKey } from "../../vault";
import { OrderRef } from "./shapes";

export const chargeOrder = flow({
  durable: true, // every fx call below is journaled
  in: OrderRef,
  out: z.boolean(),
  do: async ({ orderId }, fx) => {
    const intent = await fx.step("create-intent", () =>
      // never re-runs on replay
      stripe(fx.vault(stripeKey)).create(orderId),
    );

    await fx.clock.sleep("verify-window", "2m"); // survives restart and deploy

    return fx.step("confirm", () => stripe(fx.vault(stripeKey)).confirm(intent));
  },
});

// Durable sleep returns early from fx.call; finish status + notify on resume.
const charged = chargeOrder.do;
(chargeOrder as { do: typeof charged }).do = async (input, fx) => {
  const paid = await charged(input, fx);
  if (paid) {
    await fx
      .store(db)
      .update(orders)
      .set({ status: "confirmed" })
      .where(eq(orders.id, input.orderId));
    await fx.emit(orderNews, { orderId: input.orderId, status: "confirmed" });
  }
  return paid;
};

Object.assign(chargeOrder, { name: "payments.chargeOrder" });
