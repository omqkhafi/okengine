import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

/** Working example table — replace with your own. */
export const pings = sqliteTable("pings", {
  id: text("id").primaryKey().$defaultFn(id),
  note: text("note").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
