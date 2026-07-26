/**
 * Driver map resolution — including `stack` → prod fallback.
 */

import { describe, expect, test } from "bun:test";
import { resolveDriverId } from "./index.ts";

describe("resolveDriverId", () => {
  test("reads the named env key", () => {
    expect(
      resolveDriverId({ dev: "sqlite", prod: "postgres" }, "dev"),
    ).toBe("sqlite");
    expect(
      resolveDriverId({ dev: "sqlite", prod: "postgres" }, "prod"),
    ).toBe("postgres");
  });

  test("stack prefers stack, then prod, then dev", () => {
    expect(
      resolveDriverId(
        { dev: "sqlite", stack: "postgres", prod: "postgres" },
        "stack",
      ),
    ).toBe("postgres");
    expect(
      resolveDriverId({ dev: "sqlite", prod: "postgres" }, "stack"),
    ).toBe("postgres");
    expect(resolveDriverId({ dev: "sqlite" }, "stack")).toBe("sqlite");
  });
});
