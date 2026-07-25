import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

/** Replace with your tables — keep defaults on the schema. */
export const entries = sqliteTable("entries", {
  id: text("id").primaryKey().$defaultFn(id),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
