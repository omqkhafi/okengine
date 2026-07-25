/**
 * `--json` emits only machine-parseable JSON on stdout.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../manifest/types.ts";
import { runDoctor } from "./doctor.ts";
import { gatesList } from "./gates-list.ts";
import { runImagesList } from "./images.ts";
import { runStackPreview } from "./stack.ts";

describe("oke --json stdout discipline", () => {
  test("doctor --json is valid JSON with nothing else on stdout", async () => {
    let out = "";
    let err = "";
    const { code, findings } = await runDoctor({
      secrets: ["MISSING"],
      env: () => undefined,
      ports: [],
      currentSchemaFingerprint: null,
      json: true,
      write: (t) => {
        out += t;
      },
      writeErr: (t) => {
        err += t;
      },
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(out.trim()) as {
      ok: boolean;
      findings: unknown[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.findings).toHaveLength(findings.length);
    expect(err).toContain("Hint:");
    // stdout is exactly one JSON document (+ trailing newline)
    expect(out.trim().startsWith("{")).toBe(true);
    expect(() => JSON.parse(out.trim())).not.toThrow();
  });

  test("stack --json is valid JSON only on stdout", async () => {
    let out = "";
    const code = await runStackPreview({
      images: { "store.sql": "postgres:16-alpine" },
      json: true,
      write: (t) => {
        out += t;
      },
      writeErr: () => {},
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      ok: boolean;
      rows: { role: string }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.role).toBe("store.sql");
    expect(out.includes("ROLE")).toBe(false);
  });

  test("images list --json is valid JSON only on stdout", async () => {
    let out = "";
    let err = "";
    const code = await runImagesList({
      images: { "store.kv": "redis:7" },
      lock: null,
      json: true,
      write: (t) => {
        out += t;
      },
      writeErr: (t) => {
        err += t;
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      ok: boolean;
      images: {
        role: string;
        recipe: string;
        image: string;
        tag: string;
        digest: string;
        size: string;
      }[];
    };
    expect(parsed.images).toEqual([
      {
        role: "store.kv",
        recipe: "redis",
        image: "redis",
        tag: "7",
        digest: "-",
        size: "-",
      },
    ]);
    expect(err).toBe("");
  });

  test("gates list --json is valid JSON only on stdout", async () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "skyport",
      flows: {
        "bookings.create": { plane: "user", gates: ["booking:create"] },
      },
    };
    let out = "";
    const code = await gatesList({
      manifest,
      json: true,
      write: (t) => {
        out += t;
      },
      writeErr: () => {},
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      ok: boolean;
      gates: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.gates).toContain("booking:create");
    expect(out.includes("bookings:create\n") || parsed.gates.includes("bookings:create")).toBe(
      true,
    );
  });
});
