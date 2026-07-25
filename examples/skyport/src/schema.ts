import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey().$defaultFn(id),
  userId: text("user_id").notNull(),
  flight: text("flight").notNull(),
  status: text("status").notNull().default("held"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey().$defaultFn(id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  urgency: text("urgency").notNull(),
  team: text("team"),
  summary: text("summary"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
