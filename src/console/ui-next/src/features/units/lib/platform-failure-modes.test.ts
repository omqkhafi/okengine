/**
 * Platform failure modes — Manifest-only derivation, HTTP-encoding truth.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { flowDeclaresInputSchema, platformFailureModes } from "./platform-failure-modes.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "platform-modes-test",
  flows: {},
  gates: {
    public: { kind: "policy", description: "Open" },
    member: { kind: "policy", scopes: ["bookings:write"], description: "Members only" },
    "bookings.write": {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 30,
      per: "1m",
      keyBy: "user",
      description: "Write throttle",
    },
    mystery: { description: "No kind declared" },
  },
};

describe("flowDeclaresInputSchema", () => {
  test("true for object schema and non-empty $ref string", () => {
    expect(flowDeclaresInputSchema({ type: "object", properties: {} })).toBe(true);
    expect(flowDeclaresInputSchema("BookingIn")).toBe(true);
  });

  test("false when absent", () => {
    expect(flowDeclaresInputSchema(undefined)).toBe(false);
  });
});

describe("platformFailureModes", () => {
  test("policy gate → Unauthorized 401 + Forbidden 403 (HTTP truth)", () => {
    const modes = platformFailureModes({ gates: ["member"] }, MANIFEST);
    expect(modes).toEqual([
      {
        code: "Unauthorized",
        status: 401,
        source: "gate",
        gateName: "member",
        detail: "policy · scopes bookings:write · Members only · unauthenticated",
      },
      {
        code: "Forbidden",
        status: 403,
        source: "gate",
        gateName: "member",
        detail: "policy · scopes bookings:write · Members only · authenticated but denied",
      },
    ]);
  });

  test("rate gate → RateLimited 429", () => {
    const modes = platformFailureModes({ gates: ["bookings.write"] }, MANIFEST);
    expect(modes).toEqual([
      {
        code: "RateLimited",
        status: 429,
        source: "gate",
        gateName: "bookings.write",
        detail: "rate · sliding-window-counter · 30/1m · keyBy user · Write throttle",
      },
    ]);
  });

  test("input schema → ValidationError 422 (not Call-API chrome 400)", () => {
    const modes = platformFailureModes(
      { in: { type: "object", properties: { flightId: { type: "string" } } } },
      MANIFEST,
    );
    expect(modes).toEqual([
      {
        code: "ValidationError",
        status: 422,
        source: "schema",
        detail: "Malformed or invalid request body / input",
      },
    ]);
  });

  test("skips public gate; combines policy + rate + schema", () => {
    const modes = platformFailureModes(
      {
        gates: ["public", "member", "bookings.write"],
        in: { type: "object" },
      },
      MANIFEST,
    );
    expect(modes.map((m) => `${m.code}:${m.status}`)).toEqual([
      "Unauthorized:401",
      "Forbidden:403",
      "RateLimited:429",
      "ValidationError:422",
    ]);
    expect(modes.some((m) => m.gateName === "public")).toBe(false);
  });

  test("empty when no gates and no input schema", () => {
    expect(platformFailureModes({}, MANIFEST)).toEqual([]);
    expect(platformFailureModes({ gates: ["public"] }, MANIFEST)).toEqual([]);
  });

  test("never invents OKE#### numeric codes", () => {
    const modes = platformFailureModes(
      {
        gates: ["member", "bookings.write", "mystery"],
        in: { type: "object" },
      },
      MANIFEST,
    );
    for (const m of modes) {
      expect(String(m.code)).not.toMatch(/^OKE|\d{4}$/);
      expect(["Unauthorized", "Forbidden", "RateLimited", "ValidationError"]).toContain(m.code);
    }
  });
});
