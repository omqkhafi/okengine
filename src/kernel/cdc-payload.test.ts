/**
 * CdcPayload enrichment — action from images, PK from Manifest, additive fields.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { field, store } from "../elements/store.ts";
import type { Manifest } from "../manifest/types.ts";
import { oke } from "./app.ts";
import {
  cdcActionFromImages,
  cdcIdFromImages,
  declaredPk,
  declaredPkColumn,
  enrichCdcPayload,
  pkColumnByTableFromManifest,
  type CdcPayload,
} from "./cdc-payload.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

const manifest: Manifest = {
  oke: "1.0",
  app: "cdc-enrich",
  stores: {
    db: {
      facet: "sql",
      tables: {
        orders: {
          columns: {
            id: { type: "text", primaryKey: true, sqlName: "id" },
            status: { type: "text", sqlName: "status" },
          },
        },
        accounts: {
          columns: {
            code: { type: "text", primaryKey: true, sqlName: "code" },
            name: { type: "text", sqlName: "name" },
          },
        },
        members: {
          columns: {
            userId: { type: "text", primaryKey: true, sqlName: "user_id" },
          },
        },
      },
    },
  },
};

describe("cdc-payload helpers", () => {
  test("action is created / updated / deleted from before/after presence", () => {
    expect(cdcActionFromImages(null, { id: "1" })).toBe("created");
    expect(cdcActionFromImages({ id: "1" }, { id: "1" })).toBe("updated");
    expect(cdcActionFromImages({ id: "1" }, null)).toBe("deleted");
  });

  test("id uses after for created/updated and before for deleted", () => {
    expect(cdcIdFromImages(null, { code: "a1" }, "code")).toBe("a1");
    expect(cdcIdFromImages({ code: "a1" }, { code: "a1", name: "x" }, "code")).toBe("a1");
    expect(cdcIdFromImages({ code: "a1" }, null, "code")).toBe("a1");
  });

  test("id preserves number PKs and stringifies anything else", () => {
    expect(cdcIdFromImages(null, { id: 42 }, "id")).toBe(42);
    expect(cdcIdFromImages(null, { id: true }, "id")).toBe("true");
    expect(cdcIdFromImages(null, {}, "id")).toBe("");
  });

  test("id tries JS key then SQL name when they differ", () => {
    const pk = { key: "userId", sqlName: "user_id" };
    expect(cdcIdFromImages(null, { userId: "u1" }, pk)).toBe("u1");
    expect(cdcIdFromImages(null, { user_id: "u2" }, pk)).toBe("u2");
  });

  test("declaredPk reads Manifest primaryKey, else id", () => {
    expect(declaredPk(manifest.stores!.db!.tables!.accounts!.columns)).toEqual({
      key: "code",
      sqlName: "code",
    });
    expect(declaredPkColumn(manifest.stores!.db!.tables!.members!.columns)).toBe("user_id");
    expect(declaredPk(undefined)).toEqual({ key: "id", sqlName: "id" });
    expect(declaredPk({ name: { type: "text" } })).toEqual({ key: "id", sqlName: "id" });
  });

  test("pkColumnByTableFromManifest maps every SQL table", () => {
    const map = pkColumnByTableFromManifest(manifest);
    expect(map.get("orders")).toEqual({ key: "id", sqlName: "id" });
    expect(map.get("accounts")).toEqual({ key: "code", sqlName: "code" });
    expect(map.get("members")).toEqual({ key: "userId", sqlName: "user_id" });
    expect(pkColumnByTableFromManifest(undefined).size).toBe(0);
  });

  test("enrichCdcPayload fills table, action, and id", () => {
    expect(enrichCdcPayload("orders", null, { id: "o1", status: "open" }, "id")).toEqual({
      table: "orders",
      action: "created",
      id: "o1",
      before: null,
      after: { id: "o1", status: "open" },
    });
  });
});

describe("dispatchCdc — enriched payload", () => {
  test("insert/update/delete carry table, action, and the declared PK for two tables", async () => {
    const seen: CdcPayload[] = [];
    const db = store.sql("main");
    const orders = store.schema.table("orders", {
      id: field.text().primaryKey(),
      status: field.text(),
    });
    const accounts = store.schema.table("accounts", {
      code: field.text().primaryKey(),
      name: field.text(),
    });

    on(
      db.table(orders).changed(),
      flow("audit.orders", {
        do: (p: CdcPayload) => {
          seen.push(p);
        },
      }),
    );
    on(
      db.table(accounts).changed(),
      flow("audit.accounts", {
        do: (p: CdcPayload) => {
          seen.push(p);
        },
      }),
    );

    const app = oke({ autoBoot: false, name: "cdc-enrich", manifest });

    await app.dispatchCdc("orders", { before: null, after: { id: "o1", status: "open" } });
    await app.dispatchCdc("orders", {
      before: { id: "o1", status: "open" },
      after: { id: "o1", status: "paid" },
    });
    await app.dispatchCdc("orders", { before: { id: "o1", status: "paid" }, after: null });

    await app.dispatchCdc("accounts", { before: null, after: { code: "acme", name: "Acme" } });
    await app.dispatchCdc("accounts", {
      before: { code: "acme", name: "Acme" },
      after: { code: "acme", name: "Acme Inc" },
    });
    await app.dispatchCdc("accounts", { before: { code: "acme", name: "Acme Inc" }, after: null });

    expect(seen).toEqual([
      {
        table: "orders",
        action: "created",
        id: "o1",
        before: null,
        after: { id: "o1", status: "open" },
      },
      {
        table: "orders",
        action: "updated",
        id: "o1",
        before: { id: "o1", status: "open" },
        after: { id: "o1", status: "paid" },
      },
      {
        table: "orders",
        action: "deleted",
        id: "o1",
        before: { id: "o1", status: "paid" },
        after: null,
      },
      {
        table: "accounts",
        action: "created",
        id: "acme",
        before: null,
        after: { code: "acme", name: "Acme" },
      },
      {
        table: "accounts",
        action: "updated",
        id: "acme",
        before: { code: "acme", name: "Acme" },
        after: { code: "acme", name: "Acme Inc" },
      },
      {
        table: "accounts",
        action: "deleted",
        id: "acme",
        before: { code: "acme", name: "Acme Inc" },
        after: null,
      },
    ]);
  });

  test("a handler that only destructures { before, after } still runs", async () => {
    const seen: string[] = [];
    const db = store.sql("main");
    const orders = store.schema.table("orders", {
      id: field.text().primaryKey(),
      status: field.text(),
    });
    on(
      db.table(orders).changed("status"),
      flow("t.cdc.bare", {
        do: (p: { before: { status: string }; after: { status: string } }) => {
          seen.push(`cdc:${p.before.status}->${p.after.status}`);
        },
      }),
    );
    const app = oke({ autoBoot: false, name: "cdc-bare" });
    await app.dispatchCdc(
      "orders",
      { before: { status: "open" }, after: { status: "paid" } },
      "status",
    );
    expect(seen).toEqual(["cdc:open->paid"]);
  });
});
