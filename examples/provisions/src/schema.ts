import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  sku: text("sku").primaryKey(),
  name: text("name").notNull(),
  stock: integer("stock").notNull().default(0),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sku: text("sku").notNull(),
  qty: integer("qty").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});
