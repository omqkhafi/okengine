import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

export const entries = sqliteTable("entries", {
  id: text("id").primaryKey().$defaultFn(id),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
