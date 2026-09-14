import { field, store } from "okengine";

/** Per-member inbox rows. */
export const inbox = store.schema.table("inbox", {
  id: field.id().primaryKey(),
  memberEmail: field.text().notNull(),
  kind: field.text().notNull(),
  title: field.text().notNull(),
  refId: field.text().notNull(),
  readAt: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
});
