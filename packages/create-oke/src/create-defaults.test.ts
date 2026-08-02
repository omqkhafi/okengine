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
import { pinsLocalOnly, recommendedDefaults } from "./drivers-catalog.ts";

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
  });

  test("accepts recommended shape", () => {
    const d = recommendedDefaults("local-only", "standard");
    const parsed = parseCreateDefaults(d);
    expect(parsed?.profile).toBe("local-only");
    expect(parsed?.template).toBe("standard");
    expect(parsed?.drivers.store.sql.local).toBe("sqlite");
    expect(parsed?.ai.enabled).toBe(false);
  });

  test("older files without template default to standard", () => {
    const d = recommendedDefaults("local-only", "standard");
    const { template: _t, ...rest } = d;
    const parsed = parseCreateDefaults(rest);
    expect(parsed?.template).toBe("standard");
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
            sql: pinsLocalOnly("libsql", "postgres", "memory"),
            kv: pinsLocalOnly("redis", "redis", "memory"),
            files: pinsLocalOnly("fs", "s3", "memory"),
            index: null,
          },
          signal: pinsLocalOnly("memory", "redis", "memory"),
          clock: pinsLocalOnly("file", "file", "frozen"),
          vault: pinsLocalOnly("env", "openbao", "memory"),
          channel: { email: pinsLocalOnly("console", "smtp", "console") },
          ai: pinsLocalOnly("ollama", "ollama", "mock"),
        },
        ai: { enabled: true, provider: "ollama", driver: "ollama" },
      });
      writeCreateDefaults(original, path);
      const loaded = readCreateDefaults(path);
      expect(loaded).not.toBeNull();
      expect(loaded!.template).toBe("advanced");
      expect(loaded!.drivers.store.sql.local).toBe("libsql");
      expect(loaded!.drivers.ai?.local).toBe("ollama");
      expect(loaded!.ai.provider).toBe("ollama");
      expect(loaded!.profile).toBe("docker-ready");
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
