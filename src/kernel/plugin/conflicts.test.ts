/**
 * Conflict detection — never last-write-wins.
 */

import { describe, expect, test } from "bun:test";
import { plugin } from "../plugin.ts";
import { createPluginRegistry } from "../registry.ts";

describe("plugin conflict detection", () => {
  test("table-name collision fails the boot with both plugin names", () => {
    const registry = createPluginRegistry();

    registry.plug(
      plugin("audit", { version: "1.0.0" }).table("events"),
      { kind: "app" },
    );

    expect(() =>
      registry.plug(
        plugin("billing", { version: "1.0.0" }).table("events"),
        { kind: "app" },
      ),
    ).toThrow(
      'Plugin conflict: table "events" claimed by "audit" and "billing"',
    );
  });

  test("panel-id collision names both sides", () => {
    const registry = createPluginRegistry();

    registry.plug(
      plugin("a", { version: "1.0.0" }).consolePanel({
        id: "trail",
        title: "A",
        entry: "./a.tsx",
      }),
      { kind: "app" },
    );

    expect(() =>
      registry.plug(
        plugin("b", { version: "1.0.0" }).consolePanel({
          id: "trail",
          title: "B",
          entry: "./b.tsx",
        }),
        { kind: "app" },
      ),
    ).toThrow('Plugin conflict: panel "trail" claimed by "a" and "b"');
  });

  test("driver-id collision names both sides", () => {
    const registry = createPluginRegistry();

    registry.plug(plugin("a", { version: "1.0.0" }).driver("postgres"), {
      kind: "app",
    });

    expect(() =>
      registry.plug(plugin("b", { version: "1.0.0" }).driver("postgres"), {
        kind: "app",
      }),
    ).toThrow('Plugin conflict: driver "postgres" claimed by "a" and "b"');
  });

  test("same plugin twice at the same scope is a no-op", () => {
    const registry = createPluginRegistry();
    const p = plugin("audit", { version: "1.0.0" }).table("audit_log");

    expect(registry.plug(p, { kind: "app" })).toBeDefined();
    expect(registry.plug(p, { kind: "app" })).toBeUndefined();
    expect(registry.installed).toHaveLength(1);
  });

  test("same plugin+config at two scopes is allowed", () => {
    const registry = createPluginRegistry();
    const p = plugin("rate-limit", {
      version: "1.0.0",
      config: { max: 30 },
    }).hook("onRequest", () => {});

    expect(
      registry.plug(p, { kind: "unit", name: "orders" }),
    ).toBeDefined();
    expect(
      registry.plug(p, { kind: "unit", name: "payments" }),
    ).toBeDefined();
    expect(registry.installed).toHaveLength(2);
  });

  test("same plugin twice with conflicting config is a boot error", () => {
    const registry = createPluginRegistry();

    registry.plug(
      plugin("rate-limit", { version: "1.0.0", config: { max: 30 } }),
      { kind: "unit", name: "orders" },
    );

    expect(() =>
      registry.plug(
        plugin("rate-limit", { version: "1.0.0", config: { max: 60 } }),
        { kind: "unit", name: "payments" },
      ),
    ).toThrow(/conflicting config/);
  });
});
