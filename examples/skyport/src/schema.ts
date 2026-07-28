import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id } from "okengine/store";

export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey().$defaultFn(id),
  userId: text("user_id").notNull(),
  flightId: text("flight_id").notNull(),
  seats: integer("seats").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const flights = sqliteTable("flights", {
  id: text("id").primaryKey(),
  seatsAvailable: integer("seats_available").notNull(),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  urgency: text("urgency"),
  team: text("team"),
  summary: text("summary"),
});
