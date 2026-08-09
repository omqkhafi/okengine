/**
 * CLI rejects removed env keys / drivers in oke.config source.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOkeConfigSource, loadOkeConfig } from "./load-config.ts";

describe("assertOkeConfigSource", () => {
  test("rejects local: env keys", () => {
    expect(() =>
      assertOkeConfigSource(`drivers: { store: { sql: { local: "postgres" } } }`),
    ).toThrow(`"local" is no longer a valid environment key in oke.config.ts.`);
  });

  test('rejects "sqlite" driver pins', () => {
    expect(() => assertOkeConfigSource(`drivers: { store: { sql: { dev: "sqlite" } } }`)).toThrow(
      `"sqlite" is no longer a valid driver in oke.config.ts.`,
    );
  });

  test("allows modern three-key maps", () => {
    expect(() =>
      assertOkeConfigSource(`sql: { dev: "postgres", test: "pglite", prod: "postgres" }`),
    ).not.toThrow();
  });

  test("does not false-positive on localhost", () => {
    expect(() => assertOkeConfigSource(`url: "http://localhost:5432"`)).not.toThrow();
  });
});

describe("loadOkeConfig source gate", () => {
  test("fails before import when local: is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cfg-local-"));
    try {
      await writeFile(
        join(dir, "oke.config.ts"),
        `export default { drivers: { store: { sql: { local: "postgres", test: "pglite", prod: "postgres" } } } };\n`,
      );
      await expect(loadOkeConfig(dir)).rejects.toThrow(
        `"local" is no longer a valid environment key in oke.config.ts.`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
