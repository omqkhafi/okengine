/**
 * Unit tests for trigger → eight-element icon mapping.
 */

import { describe, expect, test } from "bun:test";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { triggerIconSpec } from "./trigger-icon.ts";

describe("triggerIconSpec", () => {
  test("maps triggers onto the eight-element vocabulary", () => {
    expect(triggerIconSpec("http")).toEqual({
      icon: ELEMENT_ICONS.flow.icon,
      label: "HTTP",
    });
    expect(triggerIconSpec("signal")).toEqual({
      icon: ELEMENT_ICONS.signal.icon,
      label: "Signal",
    });
    expect(triggerIconSpec("every")).toEqual({
      icon: ELEMENT_ICONS.clock.icon,
      label: "Clock",
    });
    expect(triggerIconSpec("cron")).toEqual({
      icon: ELEMENT_ICONS.clock.icon,
      label: "Clock",
    });
    expect(triggerIconSpec("cdc")).toEqual({
      icon: ELEMENT_ICONS.store.icon,
      label: "CDC",
    });
  });
});
