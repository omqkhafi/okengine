import { field, store } from "okengine";

/**
 * Short links — insert gated to the signed-in owner. SELECT is open
 * (`using: true`) so the public redirect and the owner read both see the
 * row once RLS is on. Owner checks for get / archive / report stay in `do`.
 */
export const links = store.schema.table(
  "links",
  {
    id: field.id().primaryKey(),
    userId: field.text().notNull(),
    code: field.text().notNull().unique(),
    url: field.text().notNull(),
    clicks: field.integer().notNull().default(0),
    expiresAt: field.timestamp(),
    archivedAt: field.timestamp(),
    createdAt: field.timestamp().notNull().now(),
  },
  [
    store.schema.policy("public read", { for: "select", using: "true" }),
    store.schema.policy.gate("member", { for: "insert" }),
    store.schema.policy.owner("userId", { for: "insert" }),
  ],
);
