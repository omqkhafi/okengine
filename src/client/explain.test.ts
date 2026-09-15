/**
 * Client `explain` / `match` / `matchError` — UX kinds, fields, result matcher.
 */

import { describe, expect, test } from "bun:test";
import { explain, match, matchError } from "./explain.ts";
import type { BuiltinErrorMap } from "../kernel/builtin-errors.ts";
import type { ClientError } from "./types.ts";

/** Compile-time equality. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

describe("explain — kinds", () => {
  test("maps built-in codes", () => {
    expect(explain({ code: "Unauthorized", data: {} }).kind).toBe("auth");
    expect(explain({ code: "AuthFailed", data: {} }).kind).toBe("auth");
    expect(explain({ code: "Forbidden", data: {} }).kind).toBe("permission");
    expect(explain({ code: "NotFound", data: { id: "n1" } }).kind).toBe("missing");
    expect(explain({ code: "Conflict", data: {} }).kind).toBe("conflict");
    expect(explain({ code: "ForeignKey", data: {} }).kind).toBe("conflict");
    expect(explain({ code: "ValidationError", data: { issues: [] } }).kind).toBe("invalid");
    expect(explain({ code: "InvalidQuery", data: {} }).kind).toBe("invalid");
    expect(explain({ code: "UnsupportedMediaType", data: {} }).kind).toBe("invalid");
    expect(explain({ code: "RateLimited", data: {} }).kind).toBe("limited");
    expect(explain({ code: "AuthRateLimited", data: {} }).kind).toBe("limited");
    expect(explain({ code: "ServiceUnavailable", data: {} }).kind).toBe("unavailable");
    expect(explain({ code: "InternalError", data: {} }).kind).toBe("failed");
  });

  test("DatabaseError reasons", () => {
    expect(explain({ code: "DatabaseError", data: { reason: "not_null" } }).kind).toBe("invalid");
    expect(explain({ code: "DatabaseError", data: { reason: "check" } }).kind).toBe("invalid");
    expect(explain({ code: "DatabaseError", data: { reason: "invalid" } }).kind).toBe("invalid");
    expect(explain({ code: "DatabaseError", data: { reason: "too_long" } }).kind).toBe("invalid");
    expect(explain({ code: "DatabaseError", data: { reason: "out_of_range" } }).kind).toBe(
      "invalid",
    );
    expect(explain({ code: "DatabaseError", data: { reason: "retryable" } }).kind).toBe(
      "unavailable",
    );
    expect(explain({ code: "DatabaseError", data: { reason: "unknown" } }).kind).toBe("failed");
    expect(explain({ code: "DatabaseError", data: {} }).kind).toBe("failed");
  });

  test("TransportError 404 is missing; other transport is unavailable", () => {
    expect(
      explain({
        code: "TransportError",
        data: { message: "Not Found", status: 404 },
      }).kind,
    ).toBe("missing");
    expect(
      explain({
        code: "TransportError",
        data: { message: "offline" },
      }).kind,
    ).toBe("unavailable");
  });

  test("domain codes are failed", () => {
    expect(explain({ code: "FlightFull", data: { seatsLeft: 0 } }).kind).toBe("failed");
    expect(explain({ code: "OutOfStock", data: { available: 0 } }).kind).toBe("failed");
  });
});

describe("explain — message, retry, fields", () => {
  test("prefers envelope message, then transport data.message, then code", () => {
    expect(
      explain({ code: "NotFound", data: {}, message: "The requested resource was not found." })
        .message,
    ).toBe("The requested resource was not found.");
    expect(
      explain({ code: "TransportError", data: { message: "HTTP 502", status: 502 } }).message,
    ).toBe("HTTP 502");
    expect(explain({ code: "OutOfStock", data: {} }).message).toBe("OutOfStock");
  });

  test("retryable and retryAfterMs", () => {
    const limited = explain({ code: "RateLimited", data: { retryAfterMs: 1500 } });
    expect(limited.retryable).toBe(true);
    expect(limited.retryAfterMs).toBe(1500);
    const unavailable = explain({ code: "ServiceUnavailable", data: { retryAfter: 12 } });
    expect(unavailable.retryable).toBe(true);
    expect(unavailable.retryAfterMs).toBe(12_000);
    const missing = explain({ code: "NotFound", data: { id: "n1" } });
    expect(missing.retryable).toBe(false);
    expect(missing.retryAfterMs).toBeUndefined();
  });

  test("ValidationError fields join path; empty path is _", () => {
    const e = explain({
      code: "ValidationError",
      data: {
        issues: [
          { message: "Required", path: ["email"] },
          { message: "Too short", path: ["user", "name"] },
          { message: "Invalid", path: [] },
        ],
      },
    });
    expect(e.kind).toBe("invalid");
    expect(e.fields).toEqual({
      email: "Required",
      "user.name": "Too short",
      _: "Invalid",
    });
  });
});

describe("matchError", () => {
  type Err = ClientError<{
    FlightFull: { seatsLeft: number };
    NotFound: Record<string, never>;
  }>;

  test("named arm narrows FlightFull data; _ handles the rest", () => {
    const full: Err = { code: "FlightFull", data: { seatsLeft: 2 } };
    const seats = matchError(full, {
      FlightFull: (data) => {
        type _D = Assert<Eq<typeof data, { seatsLeft: number }>>;
        const keep: _D = true;
        expect(keep).toBe(true);
        return data.seatsLeft;
      },
      _: () => -1,
    });
    expect(seats).toBe(2);

    const miss: Err = { code: "NotFound", data: {} };
    const fallback = matchError(miss, {
      FlightFull: (data) => data.seatsLeft,
      _: (e) => {
        expect(e.kind).toBe("missing");
        return e.code;
      },
    });
    expect(fallback).toBe("NotFound");
  });

  test("kind arm runs when the code is unnamed; code wins over kind", () => {
    const denied: Err = { code: "NotFound", data: {} };
    const kindHit = matchError(denied, {
      missing: (e) => {
        type _K = Assert<Eq<(typeof e)["kind"], "missing">>;
        const keep: _K = true;
        expect(keep).toBe(true);
        expect(e.kind).toBe("missing");
        expect(e.code).toBe("NotFound");
        return e.message;
      },
      _: () => "dump",
    });
    expect(kindHit).toBe("NotFound");

    const full: Err = { code: "FlightFull", data: { seatsLeft: 3 } };
    const codeWins = matchError(full, {
      FlightFull: (data) => data.seatsLeft,
      failed: () => -2,
      _: () => -3,
    });
    expect(codeWins).toBe(3);
  });

  test("invalid kind exposes ValidationError fields", () => {
    const err = {
      code: "ValidationError",
      data: { issues: [{ message: "Required", path: ["email"] }] },
    } as const;
    const fields = matchError(err, {
      invalid: (e) => e.fields,
      _: () => undefined,
    });
    expect(fields).toEqual({ email: "Required" });
  });
});

describe("match", () => {
  type Result =
    | { readonly data: { readonly confirmationCode: string }; readonly error: null }
    | {
        readonly data: null;
        readonly error: ClientError<{
          FlightFull: { seatsLeft: number };
          NotFound: Record<string, never>;
        }>;
      };

  test("ok arm narrows success data", () => {
    const result: Result = { data: { confirmationCode: "SK-4812" }, error: null };
    const code = match(result, {
      ok: (data) => {
        type _D = Assert<Eq<typeof data, { readonly confirmationCode: string }>>;
        const keep: _D = true;
        expect(keep).toBe(true);
        return data.confirmationCode;
      },
      _: () => "",
    });
    expect(code).toBe("SK-4812");
  });

  test("named code, kind, and _ on one call", () => {
    const full: Result = {
      data: null,
      error: { code: "FlightFull", data: { seatsLeft: 1 } },
    };
    expect(
      match(full, {
        ok: () => "ok",
        FlightFull: (data) => `wait:${data.seatsLeft}`,
        auth: () => "signin",
        _: (e) => e.message,
      }),
    ).toBe("wait:1");

    const missing: Result = { data: null, error: { code: "NotFound", data: {} } };
    expect(
      match(missing, {
        ok: () => "ok",
        FlightFull: (data) => `wait:${data.seatsLeft}`,
        missing: (e) => `gone:${e.code}`,
        _: (e) => e.message,
      }),
    ).toBe("gone:NotFound");

    const transport = {
      data: null,
      error: { code: "TransportError" as const, data: { message: "offline" } },
    };
    expect(
      match(transport, {
        ok: () => "ok",
        unavailable: (e) => {
          expect(e.retryable).toBe(true);
          return e.message;
        },
        _: () => "dump",
      }),
    ).toBe("offline");
  });
});

describe("BuiltinErrorMap ValidationError issues", () => {
  test("issues are { message, path }", () => {
    type Issue = BuiltinErrorMap["ValidationError"]["issues"][number];
    type _Msg = Assert<Eq<Issue["message"], string>>;
    type _Path = Assert<Eq<Issue["path"], ReadonlyArray<string | number>>>;
    const ok: [_Msg, _Path] = [true, true];
    expect(ok).toEqual([true, true]);
  });
});
