import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  at: integer("at").notNull(),
  payload: text("payload"),
});
