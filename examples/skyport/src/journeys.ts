import { journey } from "okengine";
import { create } from "./flows/bookings";
import { chargeBooking } from "./flows/payments";
import { send } from "./flows/notifications";

journey("book-a-flight", {
  path: [create, chargeBooking, send],
  slo: { availability: "99.5%" },
});
