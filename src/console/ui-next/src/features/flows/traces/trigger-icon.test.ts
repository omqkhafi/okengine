/**
 * Unit tests for trigger → kind icon mapping.
 */

import { describe, expect, test } from "bun:test";
import {
  ApiIcon,
  Calendar03Icon,
  FunctionCircleIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { triggerIconSpec } from "./trigger-icon.ts";

describe("triggerIconSpec", () => {
  test("maps triggers onto distinct kind glyphs", () => {
    expect(triggerIconSpec("http")).toEqual({
      icon: ApiIcon,
      label: "HTTP",
    });
    expect(triggerIconSpec("signal")).toEqual({
      icon: ELEMENT_ICONS.signal.icon,
      label: "Signal",
    });
    expect(triggerIconSpec("every")).toEqual({
      icon: Timer01Icon,
      label: "Every",
    });
    expect(triggerIconSpec("cron")).toEqual({
      icon: Calendar03Icon,
      label: "Cron",
    });
    expect(triggerIconSpec("cdc")).toEqual({
      icon: ELEMENT_ICONS.store.icon,
      label: "CDC",
    });
    expect(triggerIconSpec("internal")).toEqual({
      icon: FunctionCircleIcon,
      label: "Call-only",
    });
  });
});
