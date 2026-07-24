import { signal } from "okengine";

export const orderPlaced = signal("order-placed", {
  delivery: "once",
  retries: 5,
  deadLetter: true,
});

export const seatFeed = signal("seat-feed", {
  delivery: "live",
});
