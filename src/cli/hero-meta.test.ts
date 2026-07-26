/**
 * Hero snapshot — profile, elements, encode/decode.
 */

import { describe, expect, test } from "bun:test";
import type { OkeConfig } from "../config/index.ts";
import {
  buildDevHeroSnapshot,
  decodeHeroSnapshot,
  encodeHeroSnapshot,
  resolveDevProfile,
  resolveHeroElements,
} from "./hero-meta.ts";

const SAMPLE: OkeConfig = {
  drivers: {
    store: {
      sql: { dev: "sqlite", stack: "postgres", prod: "postgres" },
      kv: { dev: "memory", stack: "redis", prod: "redis" },
    },
    signal: { dev: "memory", stack: "postgres", prod: "postgres" },
    clock: { dev: "memory", stack: "postgres", prod: "postgres" },
    vault: { dev: "dotenv", stack: "dotenv", prod: "sops" },
    channel: {
      email: { dev: "console", stack: "smtp", prod: "smtp" },
    },
    ai: { dev: "mock", stack: "mock" },
  },
};

describe("hero-meta", () => {
  test("resolveDevProfile maps stack and NODE_ENV", () => {
    expect(resolveDevProfile({ stack: false })).toBe("local");
    expect(resolveDevProfile({ stack: true })).toBe("local-server");
    expect(resolveDevProfile({ stack: false, nodeEnv: "test" })).toBe("test");
    expect(resolveDevProfile({ stack: false, nodeEnv: "production" })).toBe(
      "production",
    );
  });

  test("resolveHeroElements lists eight elements with drivers", () => {
    const rows = resolveHeroElements(SAMPLE, { stack: false });
    expect(rows.map((r) => r.element)).toEqual([
      "flow",
      "signal",
      "store",
      "clock",
      "gate",
      "vault",
      "channel",
      "ai",
    ]);
    expect(rows.find((r) => r.element === "store")?.detail).toContain("sqlite");
    expect(rows.find((r) => r.element === "flow")?.detail).toBe("●");
  });

  test("stack profile applies to every element", () => {
    const rows = resolveHeroElements(SAMPLE, {
      stack: true,
      sqlDriver: "postgres",
      kvDriver: "redis",
    });
    const store = rows.find((r) => r.element === "store")?.detail ?? "";
    expect(store).toContain("postgres");
    expect(store).toContain("redis");
    expect(store).not.toContain("sqlite");
    expect(rows.find((r) => r.element === "signal")?.detail).toBe("postgres");
    expect(rows.find((r) => r.element === "clock")?.detail).toBe("postgres");
    expect(rows.find((r) => r.element === "channel")?.detail).toContain("smtp");
  });

  test("encode/decode round-trips", () => {
    const snap = buildDevHeroSnapshot({
      config: SAMPLE,
      stack: true,
      sqlDriver: "postgres",
      kvDriver: "redis",
      version: "0.2.4",
      nodeEnv: "development",
    });
    expect(snap.profile).toBe("local-server");
    expect(snap.runtimeEnv).toBe("local");
    expect(decodeHeroSnapshot(encodeHeroSnapshot(snap))).toEqual(snap);
  });
});
