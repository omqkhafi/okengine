/**
 * Unit tests for Call API cache glyph gating.
 */

import { describe, expect, test } from "bun:test";
import { FlashIcon, FlashOffIcon, UnavailableIcon } from "@hugeicons/core-free-icons";
import { invokeCacheSpec } from "./invoke-cache.ts";

describe("invokeCacheSpec", () => {
  test("hit / miss / none match traces", () => {
    expect(invokeCacheSpec("hit")).toMatchObject({
      icon: FlashIcon,
      label: "Cache hit",
    });
    expect(invokeCacheSpec("miss")).toMatchObject({
      icon: FlashOffIcon,
      label: "Cache miss",
    });
    expect(invokeCacheSpec("none")).toMatchObject({
      icon: UnavailableIcon,
      label: "Cache not applicable",
      className: "text-muted-foreground",
    });
  });

  test("omitted host cache is none, not a hit", () => {
    const omitted = invokeCacheSpec(undefined);
    expect(omitted.icon).toBe(UnavailableIcon);
    expect(omitted.label).toBe("Cache not applicable");
  });
});
