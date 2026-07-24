import { channel } from "okengine";

export const bookingConfirmed = channel.template("booking-confirmed", {
  medium: "email",
  locales: ["en", "ar"],
});
