/**
 * `oke gates list` prints every Module:Action pair.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../manifest/types.ts";
import { gatesList, gatesListCli } from "./gates-list.ts";

describe("oke gates list", () => {
  test("prints every pair derived from the Manifest", async () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "skyport",
      flows: {
        "bookings.create": { plane: "user", gates: ["booking:create"] },
        "flights.search": { plane: "user" },
      },
    };
    let out = "";
    const code = await gatesList({
      manifest,
      write: (t) => {
        out += t;
      },
    });
    expect(code).toBe(0);
    expect(out).toContain("bookings:create");
    expect(out).toContain("flights:search");
    expect(out).toContain("booking:create");
    expect(out).toContain("console:flows:invoke-as");
  });

  test("CLI help documents --json|-j", async () => {
    let out = "";
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      out += args.map(String).join(" ");
    };
    try {
      expect(await gatesListCli(["--help"])).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(out).toContain("--json");
    expect(out).toContain("-j");
  });
});
