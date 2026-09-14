import { field, store } from "okengine";

/** Goals that projects can attach to. */
export const goals = store.schema.table("goals", {
  id: field.id().primaryKey(),
  name: field.text().notNull(),
  status: field.text().notNull(),
  ownerEmail: field.text().pii(),
  targetDate: field.timestamp(),
  createdAt: field.timestamp().notNull().now(),
  updatedAt: field.timestamp().notNull().now(),
});
