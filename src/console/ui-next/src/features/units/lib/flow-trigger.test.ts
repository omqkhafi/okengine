/**
 * Unit tests for Manifest flow trigger → icon mapping.
 */

import { describe, expect, test } from "bun:test";
import {
  ApiIcon,
  Calendar03Icon,
  FunctionCircleIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { flowTriggerSpec } from "./flow-trigger.ts";

describe("flowTriggerSpec", () => {
  test("maps each trigger kind to a distinct glyph", () => {
    expect(flowTriggerSpec({ http: { method: "POST", path: "/x" } })).toMatchObject({
      kind: "http",
      icon: ApiIcon,
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
      icon: Calendar03Icon,
      label: "Cron",
      detail: "0 0 * * *",
    });
    expect(flowTriggerSpec({ every: "5m" })).toMatchObject({
      kind: "every",
      icon: Timer01Icon,
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

  test("call-only flows use the function glyph (not HTTP)", () => {
    expect(flowTriggerSpec(undefined)).toMatchObject({
      kind: "internal",
      icon: FunctionCircleIcon,
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
