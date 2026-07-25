import { describe, expect, test } from "bun:test";
import {
  openAccessEntity,
  parseAccessSearch,
  serializeAccessSearch,
} from "./search.ts";

describe("access search", () => {
  test("round-trip plane + entity", () => {
    const next = openAccessEntity({}, "user", "key", "key_demo");
    expect(next.plane).toBe("user");
    expect(next.kind).toBe("key");
    expect(next.id).toBe("key_demo");
    const serialized = serializeAccessSearch(next);
    expect(parseAccessSearch(serialized)).toMatchObject(next);
  });
});
