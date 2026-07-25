import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { now } from "okengine/store";

/** Short links — primary key is `code`. */
export const links = sqliteTable("links", {
  code: text("code").primaryKey(),
  url: text("url").notNull(),
  userId: text("user_id"),
  clicks: integer("clicks").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** Per-day click counters. */
export const daily = sqliteTable("daily", {
  code: text("code").notNull(),
  day: text("day").notNull(),
  clicks: integer("clicks").notNull().default(0),
});
