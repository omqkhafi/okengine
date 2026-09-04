import { signal } from "okengine";

export const orderPlaced = signal.once("order-placed", { retries: 5, deadLetter: true });

export const seatFeed = signal.live("seat-feed");
