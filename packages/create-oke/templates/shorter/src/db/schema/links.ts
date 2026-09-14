import { field, store } from "okengine";

/**
 * Short links — insert gated to the signed-in owner; SELECT is open for public
 * redirect. Owner checks for get / archive / report live in Flow `do`.
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
    store.schema.policy.gate("member", { for: "insert" }),
    store.schema.policy.owner("userId", { for: "insert" }),
  ],
);
