/**
 * Unit tests for Manifest flow trigger → element icon mapping.
 */

import { describe, expect, test } from "bun:test";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { flowTriggerSpec } from "./flow-trigger.ts";

describe("flowTriggerSpec", () => {
  test("maps trigger kinds onto the eight-element vocabulary", () => {
    expect(flowTriggerSpec({ http: { method: "POST", path: "/x" } })).toMatchObject({
      kind: "http",
      icon: ELEMENT_ICONS.flow.icon,
      label: "HTTP",
      detail: "POST /x",
    });
    expect(flowTriggerSpec({ signal: "order-placed" })).toMatchObject({
      kind: "signal",
      icon: ELEMENT_ICONS.signal.icon,
      label: "Signal",
      detail: "order-placed",
    });
    expect(flowTriggerSpec({ cron: "0 0 * * *" })).toMatchObject({
      kind: "cron",
      icon: ELEMENT_ICONS.clock.icon,
      label: "Cron",
      detail: "0 0 * * *",
    });
    expect(flowTriggerSpec({ every: "5m" })).toMatchObject({
      kind: "every",
      icon: ELEMENT_ICONS.clock.icon,
      label: "Every",
      detail: "5m",
    });
    expect(flowTriggerSpec({ cdc: { table: "orders" } })).toMatchObject({
      kind: "cdc",
      icon: ELEMENT_ICONS.store.icon,
      label: "CDC",
      detail: "orders",
    });
  });

  test("call-only flows fall back to the Flow glyph", () => {
    expect(flowTriggerSpec(undefined)).toMatchObject({
      kind: "internal",
      icon: ELEMENT_ICONS.flow.icon,
      label: "Call-only",
      detail: null,
    });
    expect(flowTriggerSpec({})).toMatchObject({ kind: "internal", detail: null });
  });

  test("prefers http when multiple triggers are declared", () => {
    const spec = flowTriggerSpec({ http: { method: "GET", path: "/a" }, signal: "s" });
    expect(spec.kind).toBe("http");
  });
});
