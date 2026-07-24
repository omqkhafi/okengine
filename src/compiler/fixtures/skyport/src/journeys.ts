import { journey } from "okengine";
import { create } from "./flows/bookings/index.ts";
import { chargeBooking } from "./flows/payments/index.ts";

journey("book-a-flight", {
  path: [create, chargeBooking],
  slo: { availability: "99.5%" },
  composes: "99.6%",
});
