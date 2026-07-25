import { flow } from "okengine";
import { stripeKey } from "../../vault";
import { ChargeIn } from "./shapes";

export const chargeBooking = flow({
  name: "payments.chargeBooking",
  durable: true,
  in: ChargeIn,
  do: async ({ orderId }, fx) => {
    const intent = await fx.step("create-intent", () => fx.vault(stripeKey));
    await fx.clock.sleep("verify-window", "2m");
    return fx.step("confirm", () => ({ orderId, intent }));
  },
});
