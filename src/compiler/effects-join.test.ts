/**
 * Joins and groupBy list every source table under the flow's reads.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

describe("extractManifest — joins", () => {
  test("innerJoin and groupBy record every table", async () => {
    const manifest = await extractFromSources({
      "src/app.ts": `
        import { oke } from "okengine";
        export const app = oke({ name: "joins" });
      `,
      "src/flows/orders.ts": `
        import { on, flow, http, store, field } from "okengine";
        import { eq, count } from "drizzle-orm";

        export const db = store.sql("db");
        export const orders = store.schema.table("orders", {
          id: field.text().primaryKey(),
          customerId: field.text(),
        });
        export const customers = store.schema.table("customers", {
          id: field.text().primaryKey(),
        });

        export const totals = on(
          http.get("/totals"),
          flow("orders.totals", {
            do: async (_input, fx) => {
              return fx
                .store(db)
                .select({ n: count() })
                .from(orders)
                .innerJoin(customers, eq(orders.customerId, customers.id))
                .groupBy(customers.id);
            },
          }),
        );
      `,
    });
    expect(manifest.flows?.["orders.totals"]?.effects?.reads?.slice().sort()).toEqual([
      "sql:customers",
      "sql:orders",
    ]);
  });
});
