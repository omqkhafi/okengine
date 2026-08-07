/**
 * Boot honesty suppress flag for the `oke dev` Backend child.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { emitBootWarn } from "./boot-warn.ts";

describe("emitBootWarn", () => {
  const prev = process.env["OKE_SUPPRESS_BOOT_WARN"];

  afterEach(() => {
    if (prev === undefined) delete process.env["OKE_SUPPRESS_BOOT_WARN"];
    else process.env["OKE_SUPPRESS_BOOT_WARN"] = prev;
  });

  test("forwards to console.warn by default", () => {
    delete process.env["OKE_SUPPRESS_BOOT_WARN"];
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      emitBootWarn("oke boot: test notice");
      expect(lines).toEqual(["oke boot: test notice"]);
    } finally {
      console.warn = original;
    }
  });

  test("no-ops when OKE_SUPPRESS_BOOT_WARN=1", () => {
    process.env["OKE_SUPPRESS_BOOT_WARN"] = "1";
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      emitBootWarn("oke boot: hidden");
      expect(lines).toEqual([]);
    } finally {
      console.warn = original;
    }
  });
});
