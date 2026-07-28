import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import * as v from "valibot";
import { z } from "zod";
import {
  fromTypeBox,
  isStandardSchema,
  validate,
  VALIDATION_ERROR_CODE,
} from "./standard-schema.ts";

describe("Standard Schema — four libraries", () => {
  test("Zod 4 validates and fails with typed ValidationError", async () => {
    const schema = z.object({
      flightId: z.string().min(1),
      seats: z.number().int().min(1),
    });
    expect(isStandardSchema(schema)).toBe(true);

    const ok = await validate(schema, { flightId: "SK1", seats: 2 });
    expect(ok).toEqual({
      ok: true,
      value: { flightId: "SK1", seats: 2 },
    });

    const bad = await validate(schema, { flightId: "", seats: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.data).toBeNull();
      expect(bad.failure.error.code).toBe(VALIDATION_ERROR_CODE);
      expect(bad.failure.error.data.issues.length).toBeGreaterThan(0);
      expect(bad.failure.error.data.issues[0]?.message.length).toBeGreaterThan(0);
    }
  });

  test("Valibot works via ~standard", async () => {
    const schema = v.object({
      code: v.pipe(v.string(), v.minLength(2)),
    });
    expect(isStandardSchema(schema)).toBe(true);
    const ok = await validate(schema, { code: "sa" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toEqual({ code: "sa" });

    const bad = await validate(schema, { code: "x" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.error.code).toBe(VALIDATION_ERROR_CODE);
    }
  });

  test("ArkType works via ~standard", async () => {
    const schema = type({
      email: "string.email",
    });
    expect(isStandardSchema(schema)).toBe(true);
    const ok = await validate(schema, { email: "a@b.co" });
    expect(ok.ok).toBe(true);

    const bad = await validate(schema, { email: "nope" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.error.code).toBe(VALIDATION_ERROR_CODE);
    }
  });

  test("TypeBox works via fromTypeBox adapter", async () => {
    const schematic = Type.Object({
      seats: Type.Integer({ minimum: 1 }),
    });
    const schema = fromTypeBox<{ seats: number }>(schematic, Value);
    expect(isStandardSchema(schema)).toBe(true);

    const ok = await validate(schema, { seats: 3 });
    expect(ok).toEqual({ ok: true, value: { seats: 3 } });

    const bad = await validate(schema, { seats: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.error.code).toBe(VALIDATION_ERROR_CODE);
      expect(bad.failure.error.data.issues.some((i) => i.path.includes("seats"))).toBe(true);
    }
  });

  test("non-schema values pass through without throwing", async () => {
    const result = await validate({ not: "a schema" }, { x: 1 });
    expect(result).toEqual({ ok: true, value: { x: 1 } });
    const empty = await validate(undefined, 42);
    expect(empty).toEqual({ ok: true, value: 42 });
  });
});
