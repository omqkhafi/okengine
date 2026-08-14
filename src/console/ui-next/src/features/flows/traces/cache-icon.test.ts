/**
 * Unit tests for cache → row glyph mapping.
 */

import { describe, expect, test } from "bun:test";
import { FlashIcon, FlashOffIcon, UnavailableIcon } from "@hugeicons/core-free-icons";
import { cacheIconSpec } from "./cache-icon.ts";

describe("cacheIconSpec", () => {
  test("maps hit / miss / none onto distinct glyphs", () => {
    expect(cacheIconSpec("hit")).toEqual({
      icon: FlashIcon,
      label: "Cache hit",
      className: "text-sky-500 dark:text-sky-400",
    });
    expect(cacheIconSpec("miss")).toEqual({
      icon: FlashOffIcon,
      label: "Cache miss",
      className: "text-amber-600 dark:text-amber-400",
    });
    expect(cacheIconSpec("none")).toEqual({
      icon: UnavailableIcon,
      label: "Cache not applicable",
      className: "text-muted-foreground/40",
    });
  });
});
