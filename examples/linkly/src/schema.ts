import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const links = sqliteTable("links", {
  id:        text("id").primaryKey(),               // `increment` targets this column
  code:      text("code").notNull().unique(),        // the short, human-facing key
  url:       text("url").notNull(),
  userId:    text("user_id").notNull(),
  clicks:    integer("clicks").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const daily = sqliteTable("daily", {
  id:     text("id").primaryKey(),
  code:   text("code").notNull(),
  day:    text("day").notNull(),                      // "YYYY-MM-DD"
  clicks: integer("clicks").notNull().default(0),
});
