/**
 * Seed display helpers — password redaction must stay human-readable.
 */

import { describe, expect, test } from "bun:test";
import { redactConnectionTarget } from "./db-seed.ts";

describe("redactConnectionTarget", () => {
  test("replaces password with bullets without percent-encoding", () => {
    const out = redactConnectionTarget("postgres://oke:s3cret@127.0.0.1:5432/oke");
    expect(out).toBe("postgres://oke:••••@127.0.0.1:5432/oke");
    expect(out).not.toContain("%E2%80%A2");
    expect(out).not.toContain("s3cret");
  });

  test("keeps URLs without passwords", () => {
    expect(redactConnectionTarget("postgres://oke@127.0.0.1:5432/oke")).toContain(
      "postgres://oke@",
    );
  });

  test("passes through opaque non-URL strings", () => {
    expect(redactConnectionTarget("not a url at all")).toBe("not a url at all");
  });
});
