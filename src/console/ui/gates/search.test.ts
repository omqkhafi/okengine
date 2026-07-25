/**
 * Gates URL search state tests (console §7 · §9.7).
 */

import { describe, expect, test } from "bun:test";
import {
  decodePrincipal,
  encodePrincipal,
  openFlow,
  openPrincipal,
  parseGatesSearch,
  serializeGatesSearch,
} from "./search.ts";

describe("gates search", () => {
  test("round-trips principal inquiry", () => {
    const next = openPrincipal({}, "role", "role_member");
    expect(next.from).toBe("principal");
    expect(next.principal).toBe("role:role_member");
    expect(decodePrincipal(next.principal)).toEqual({
      kind: "role",
      id: "role_member",
    });
    expect(serializeGatesSearch(next)).toEqual({
      from: "principal",
      principal: "role:role_member",
    });
  });

  test("round-trips flow inquiry", () => {
    const next = openFlow({ q: "book" }, "bookings.create");
    expect(next.from).toBe("flow");
    expect(next.flow).toBe("bookings.create");
    expect(parseGatesSearch(serializeGatesSearch(next))).toMatchObject({
      from: "flow",
      flow: "bookings.create",
      q: "book",
    });
  });

  test("encode/decode principal", () => {
    expect(encodePrincipal("key", "key_demo")).toBe("key:key_demo");
    expect(decodePrincipal("user:user_demo")).toEqual({
      kind: "user",
      id: "user_demo",
    });
    expect(decodePrincipal("nope")).toBeNull();
  });
});
