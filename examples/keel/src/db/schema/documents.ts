import { field, store } from "okengine";

/** Documents attached to a parent kind/id. */
export const documents = store.schema.table("documents", {
  id: field.id().primaryKey(),
  title: field.text().notNull(),
  body: field.text().notNull(),
  parentKind: field.text().notNull(),
  parentId: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});
