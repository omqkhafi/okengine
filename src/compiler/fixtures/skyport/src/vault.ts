import { vault } from "okengine";

export const stripeKey = vault("STRIPE_KEY", {
  description: "Payments gateway key",
  rotate: "90d",
});
