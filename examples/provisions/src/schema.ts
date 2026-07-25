import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

/** Orders. */
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey().$defaultFn(id),
  userId: text("user_id").notNull(),
  sku: text("sku").notNull(),
  qty: integer("qty").notNull(),
  status: text("status").notNull().default("pending"),
  total: integer("total").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** Stock levels by SKU. */
export const stock = sqliteTable("stock", {
  sku: text("sku").primaryKey(),
  qty: integer("qty").notNull(),
});
