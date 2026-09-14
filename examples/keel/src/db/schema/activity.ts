import { field, store } from "okengine";

/** Activity feed rows for any parent kind. */
export const activity = store.schema.table("activity", {
  id: field.id().primaryKey(),
  parentKind: field.text().notNull(),
  parentId: field.text().notNull(),
  actorEmail: field.text().pii(),
  kind: field.text().notNull(),
  body: field.text().notNull(),
  createdAt: field.timestamp().notNull().now(),
});
