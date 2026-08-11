/**
 * Persistence round-trip for ~/.oke/create-defaults.json
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultsPath,
  parseCreateDefaults,
  readCreateDefaults,
  toCreateDefaults,
  writeCreateDefaults,
} from "./create-defaults.ts";
import { pinsDockerReady, recommendedDefaults } from "./drivers-catalog.ts";

describe("createDefaultsPath", () => {
  test("joins ~/.oke/create-defaults.json", () => {
    expect(createDefaultsPath("/tmp/home")).toBe(join("/tmp/home", ".oke", "create-defaults.json"));
  });
});

describe("parseCreateDefaults", () => {
  test("rejects corrupt / wrong version", () => {
    expect(parseCreateDefaults(null)).toBeNull();
    expect(parseCreateDefaults({ version: 2 })).toBeNull();
    expect(parseCreateDefaults({ version: 1, profile: "nope" })).toBeNull();
    expect(parseCreateDefaults({ version: 1, profile: "local-only" })).toBeNull();
  });

  test("accepts recommended shape", () => {
    const d = recommendedDefaults("docker-ready", "standard");
    const parsed = parseCreateDefaults(d);
    expect(parsed?.profile).toBe("docker-ready");
    expect(parsed?.template).toBe("standard");
    expect(parsed?.drivers.store.sql.dev).toBe("postgres");
    expect(parsed?.drivers.store.sql.test).toBe("pglite");
    expect(parsed?.ai.enabled).toBe(false);
  });

  test("older files without template default to standard", () => {
    const d = recommendedDefaults("docker-ready", "standard");
    const { template: _t, ...rest } = d;
    const parsed = parseCreateDefaults(rest);
    expect(parsed?.template).toBe("standard");
  });

  test("older files without proxy default to none", () => {
    const d = recommendedDefaults("docker-ready", "standard");
    const { proxy: _p, ...rest } = d;
    const parsed = parseCreateDefaults(rest);
    expect(parsed?.proxy).toBe("none");
  });
});

describe("read/write round-trip", () => {
  test("write → read returns same drivers", () => {
    const home = mkdtempSync(join(tmpdir(), "oke-create-defaults-"));
    const path = createDefaultsPath(home);
    try {
      const original = toCreateDefaults({
        template: "advanced",
        profile: "docker-ready",
        drivers: {
          store: {
            sql: pinsDockerReady("postgres", "pglite"),
            kv: pinsDockerReady("redis", "memory"),
            files: pinsDockerReady("s3", "memory"),
            index: null,
          },
          signal: pinsDockerReady("redis", "memory"),
          clock: pinsDockerReady("file", "frozen"),
          vault: pinsDockerReady("vault", "memory"),
          channel: { email: pinsDockerReady("smtp", "console") },
          ai: pinsDockerReady("ollama", "mock"),
        },
        ai: { enabled: true, provider: "ollama", driver: "ollama" },
        locales: ["ar"],
        pgdog: true,
        proxy: "caddy",
      });
      writeCreateDefaults(original, path);
      const loaded = readCreateDefaults(path);
      expect(loaded).not.toBeNull();
      expect(loaded!.template).toBe("advanced");
      expect(loaded!.drivers.store.sql.dev).toBe("postgres");
      expect(loaded!.drivers.ai?.dev).toBe("ollama");
      expect(loaded!.ai.provider).toBe("ollama");
      expect(loaded!.profile).toBe("docker-ready");
      expect(loaded!.locales).toEqual(["ar"]);
      expect(loaded!.pgdog).toBe(true);
      expect(loaded!.proxy).toBe("caddy");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("missing file → null", () => {
    const home = mkdtempSync(join(tmpdir(), "oke-create-defaults-miss-"));
    try {
      expect(readCreateDefaults(createDefaultsPath(home))).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
