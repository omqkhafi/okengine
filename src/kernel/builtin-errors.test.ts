/**
 * Built-in failure HTTP status map.
 */

import { describe, expect, test } from "bun:test";
import { fail } from "./errors.ts";
import { httpStatusForFailure, statusForBuiltinError } from "./builtin-errors.ts";
import { encodeExecuteResult, statusForFailure } from "../compiler/response.ts";

describe("statusForBuiltinError", () => {
  test("maps REST codes", () => {
    expect(statusForBuiltinError("NotFound")).toBe(404);
    expect(statusForBuiltinError("Conflict")).toBe(409);
    expect(statusForBuiltinError("ForeignKey")).toBe(409);
    expect(statusForBuiltinError("Unauthorized")).toBe(401);
    expect(statusForBuiltinError("Forbidden")).toBe(403);
    expect(statusForBuiltinError("RateLimited")).toBe(429);
    expect(statusForBuiltinError("AuthRateLimited")).toBe(429);
    expect(statusForBuiltinError("ValidationError")).toBe(422);
    expect(statusForBuiltinError("UnsupportedMediaType")).toBe(415);
    expect(statusForBuiltinError("ServiceUnavailable")).toBe(503);
    expect(statusForBuiltinError("InternalError")).toBe(500);
    expect(statusForBuiltinError("AuthFailed")).toBe(400);
    expect(statusForBuiltinError("InvalidQuery")).toBe(400);
  });

  test("DatabaseError status follows data.reason", () => {
    expect(statusForBuiltinError("DatabaseError", { reason: "not_null" })).toBe(422);
    expect(statusForBuiltinError("DatabaseError", { reason: "check" })).toBe(422);
    expect(statusForBuiltinError("DatabaseError", { reason: "retryable" })).toBe(503);
    expect(statusForBuiltinError("DatabaseError", { reason: "unknown" })).toBe(500);
    expect(statusForBuiltinError("DatabaseError", {})).toBe(500);
  });

  test("domain codes are undefined so HTTP defaults to 400", () => {
    expect(statusForBuiltinError("OutOfStock")).toBeUndefined();
    expect(httpStatusForFailure("OutOfStock")).toBe(400);
    expect(httpStatusForFailure("OKE1110")).toBe(500);
  });
});

describe("statusForFailure", () => {
  test("reads DatabaseError reason from the envelope", () => {
    expect(statusForFailure(fail("DatabaseError", { reason: "not_null" }))).toBe(422);
    expect(statusForFailure(fail("NotFound", { id: "n1" }))).toBe(404);
    expect(statusForFailure(fail("FlightFull", { seatsLeft: 0 }))).toBe(400);
  });
});

describe("encodeExecuteResult InternalError", () => {
  test("never copies the thrown Error.message", async () => {
    const res = await encodeExecuteResult({ error: new Error("secret leak") });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      data: null;
      error: { code: string; message?: string; data?: unknown };
    };
    expect(body.error.code).toBe("InternalError");
    expect(JSON.stringify(body)).not.toContain("secret leak");
  });

  test("maps leftover unique SQLSTATE to Conflict", async () => {
    const res = await encodeExecuteResult({
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        detail: "Key (email)=(a@b.c) already exists.",
      },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("Conflict");
    expect(JSON.stringify(body)).not.toContain("a@b.c");
  });

  test("maps exhausted serialization failure to ServiceUnavailable", async () => {
    const res = await encodeExecuteResult({
      error: { code: "40001", message: "could not serialize access" },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ServiceUnavailable");
  });
});
