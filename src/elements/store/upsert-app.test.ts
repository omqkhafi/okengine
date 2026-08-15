/**
 * Real app-boot path for fx.store(db).upsert — must work through
 * oke() → createTestApp → app.fetch(), not only the isolated SqlStoreHandle.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { gate } from "../gate.ts";
import { oke } from "../../kernel/app.ts";
import { createFx } from "../../kernel/fx.ts";
import { flow, resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { createTestApp } from "../../test/create-test-app.ts";
import { field, id, now, store } from "../store.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const notes = store.schema.table("notes", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  body: field.text().notNull(),
  createdAt: field.integer().notNull().defaultFn(now),
});

const UpsertIn = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  onExisting: z.enum(["update"]).optional(),
});

const UpsertOut = z.object({
  status: z.enum(["upserted", "changed", "already-existed"]),
});

describe("fx.store(db).upsert via app.fetch (real boot)", () => {
  test("abstract schema table: upserted → already-existed → changed", async () => {
    resetBindings();
    resetFlowSeq();

    const db = store.sql("app", { schema: { notes } });

    const seed = on(
      http.post("/seed").gate.public,
      flow("notes.seed", {
        in: UpsertIn,
        out: UpsertOut,
        effects: { writes: ["sql:app"], reads: ["sql:app"] },
        do: async (input, fx) =>
          fx
            .store(db)
            .upsert(
              notes,
              { id: input.id },
              { id: input.id, title: input.title, body: input.body, createdAt: 1 },
              input.onExisting ? { onExisting: input.onExisting } : undefined,
            ),
      }),
    );

    const app = oke({
      name: "upsert-app-boot",
      gate: { policies: [gate.public] },
    }).adopt({ seed });
    Object.assign(app.$options, { env: "test", stores: [db], unguardedHttp: "allow" });
    await createTestApp(app);

    async function post(body: unknown) {
      const res = await app.fetch(
        new Request("http://localhost/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: { status: string } };
      return json.data.status;
    }

    expect(await post({ id: "welcome", title: "Hello", body: "one" })).toBe("upserted");
    expect(await post({ id: "welcome", title: "Changed", body: "two" })).toBe("already-existed");
    expect(
      await post({
        id: "welcome",
        title: "Updated",
        body: "three",
        onExisting: "update",
      }),
    ).toBe("changed");
  });

  test("SQL StoreDecl without store runtime fails loudly (not stub upsert-missing)", async () => {
    const db = store.sql("app", { schema: { notes } });
    const fx = createFx({ flow: "orphan" });
    expect(() => fx.store(db)).toThrow(/no store runtime/);
  });
});
