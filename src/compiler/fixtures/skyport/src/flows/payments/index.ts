import { flow } from "okengine";
import { stripeKey } from "../../vault.ts";

export const chargeBooking = flow({
  name: "payments.chargeBooking",
  durable: true,
  do: async ({ orderId }, fx) => {
    const intent = await fx.step("create-intent", () => fx.vault(stripeKey));
    await fx.clock.sleep("verify-window", "2m");
    return fx.step("confirm", () => intent);
  },
});
