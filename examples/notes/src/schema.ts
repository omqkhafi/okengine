import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
