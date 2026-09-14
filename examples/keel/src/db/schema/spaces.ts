import { field, store } from "okengine";

/** Workspaces that own projects and members. */
export const spaces = store.schema.table("spaces", {
  id: field.id().primaryKey(),
  key: field.text().notNull().unique(),
  name: field.text().notNull(),
  color: field.text(),
  createdAt: field.timestamp().notNull().now(),
});
