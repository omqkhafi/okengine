import { flow } from "okengine";
import { stripeKey } from "../../vault.ts";

export const chargeBooking = flow({
  name: "payments.chargeBooking",
  durable: true,
  do: async ({ orderId }, fx) => {
    // Journal only serializable step values — a Redacted is not journaled.
    const intent = await fx.step("create-intent", async () => ({
      id: `pi_${orderId}`,
      key: fx.vault(stripeKey).reveal(),
    }));
    await fx.clock.sleep("verify-window", "2m");
    return fx.step("confirm", () => intent);
  },
});
