/**
 * Keel store decls — seeded KV must be durable (Redis has no AOF).
 */

import { describe, expect, test } from "bun:test";
import { draftsKv, remindersKv, viewPrefsKv, webhooksKv } from "./store.ts";

describe("keel store decls", () => {
  test("every keel KV namespace is durable so seed survives Redis recreate", () => {
    expect(draftsKv.durable).toBe(true);
    expect(remindersKv.durable).toBe(true);
    expect(viewPrefsKv.durable).toBe(true);
    expect(webhooksKv.durable).toBe(true);
  });
});
