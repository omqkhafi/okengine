/**
 * Capability capture — registration against the builder we supply.
 */

import { describe, expect, test } from "bun:test";
import { flow } from "../flow.ts";
import { plugin } from "../plugin.ts";
import { createPluginRegistry, createRecordingApi } from "../registry.ts";

describe("plugin capability capture", () => {
  test("recording api captures declares vs intercepts", () => {
    const audit = plugin("audit", { version: "1.0.0" })
      .config({} as never)
      .element({ kind: "store.sql", name: "audit" })
      .needs("store.kv")
      .decorate("audit", { enabled: true })
      .hook("afterHandle", async () => {})
      .errors({ AuditWriteFailed: {} as never })
      .consolePanel({
        id: "audit",
        title: "Audit Trail",
        entry: "./panel.tsx",
      })
      .cli("audit:export", () => undefined)
      .table("audit_events")
      .driver("postgres")
      .image("store.sql", "postgres:16")
      .flow(flow({ name: "audit.flush", do: () => undefined }))
      .client("audit", { subscribe: true });

    const { api, snapshot } = createRecordingApi({
      name: "audit",
      version: "1.0.0",
    });
    audit.register(api);
    const caps = snapshot().capabilities;

    const expected = {
      name: "audit",
      version: "1.0.0",
      declares: [
        "config",
        "store.sql:audit",
        "decorate:audit",
        "errors:AuditWriteFailed",
        "consolePanel:audit",
        "cli:audit:export",
        "table:audit_events",
        "driver:postgres",
        "image:store.sql",
        "flow:audit.flush",
        "client:audit",
      ],
      intercepts: ["afterHandle"],
      needs: ["store.kv"],
    };

    expect(caps).toEqual(expected);
  });

  test("registry.capabilities matches hand-written expectation after plug", () => {
    const registry = createPluginRegistry();
    const p = plugin("audit", { version: "1.0.0" })
      .element({ kind: "store.sql", name: "audit" })
      .consolePanel({
        id: "audit",
        title: "Audit Trail",
        entry: "./panel.tsx",
      })
      .hook("afterHandle", () => {});

    registry.plug(p, { kind: "app" });

    expect(registry.capabilities()).toEqual({
      audit: {
        name: "audit",
        version: "1.0.0",
        declares: ["store.sql:audit", "consolePanel:audit"],
        intercepts: ["afterHandle"],
        needs: [],
      },
    });
  });
});
