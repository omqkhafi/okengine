import { on, flow } from "okengine";
import { bookingConfirmed } from "../../channels";
import { orderPlaced } from "../bookings/signals";

export const send = on(
  orderPlaced,
  flow({
    name: "notifications.send",
    do: async ({ id }, fx) => {
      await fx.send(bookingConfirmed, {
        to: fx.auth.userId ?? "guest",
        data: { name: "Traveler", bookingId: id },
      });
    },
  }),
);
