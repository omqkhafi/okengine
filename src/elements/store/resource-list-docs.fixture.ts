/**
 * Typechecked fixtures backing the two illustrative Store list configurations
 * on the Store element docs page. They compile against the real
 * `store.resource` / `ResourceListOptions` API — not a teaching-app claimed
 * fence. If the resource list options change, these fail typecheck instead of
 * rotting into invalid prose syntax.
 *
 * Docs copy the `list: { … }` option blocks below as unheaded illustrative
 * fences; the 422 behavior for the restricted variant is locked by
 * `resource-list-docs.test.ts`.
 */

import { z } from "zod";
import { field, id, now, store } from "../store.ts";

const docsItems = store.schema.table("docs_items", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  secret: field.text().notNull(),
  createdAt: field.integer().notNull().defaultFn(now),
});

const db = store.sql("docs-items", { schema: { docs_items: docsItems } });

const inSchema = z.object({ title: z.string().min(1), secret: z.string().min(1) });
const outSchema = z.object({
  id: z.string(),
  title: z.string(),
  secret: z.string(),
  createdAt: z.number(),
});

/**
 * Admin table — offset paging with an exact row count. Docs illustrate
 * `count: "exact"` (offset default) and point to `count: "none"` as the escape
 * hatch when COUNT(*) is too expensive.
 */
export const docsAdminTableResource = store.resource(db, docsItems, {
  in: inSchema,
  out: outSchema,
  list: { mode: "offset", count: "exact", limit: 20 },
  unit: "docs-admin",
  breaking: true,
});

/**
 * Public restricted endpoint — filters off entirely. Any `?col=op.value`
 * query key that is not a reserved list param fails validation (422).
 */
export const docsRestrictedResource = store.resource(db, docsItems, {
  in: inSchema,
  out: outSchema,
  list: { mode: "offset", filter: "none", limit: 20 },
  unit: "docs-restricted",
  breaking: true,
});
