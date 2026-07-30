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
      sql: { local: "sqlite", docker: "postgres", prod: "postgres" },
      kv: { local: "memory", docker: "redis", prod: "redis" },
    },
    signal: { local: "memory", docker: "postgres", prod: "postgres" },
    clock: { local: "memory", docker: "postgres", prod: "postgres" },
    vault: { local: "dotenv", docker: "openbao", prod: "openbao" },
    channel: {
      email: { local: "console", docker: "smtp", prod: "smtp" },
    },
    ai: { local: "mock", docker: "mock" },
  },
};

describe("hero-meta", () => {
  test("resolveDevProfile maps docker and NODE_ENV", () => {
    expect(resolveDevProfile({ docker: false })).toBe("local");
    expect(resolveDevProfile({ docker: true })).toBe("docker");
    expect(resolveDevProfile({ docker: false, nodeEnv: "test" })).toBe("test");
    expect(resolveDevProfile({ docker: false, nodeEnv: "production" })).toBe("production");
  });

  test("resolveHeroElements lists eight elements with drivers", () => {
    const rows = resolveHeroElements(SAMPLE, { docker: false });
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

  test("docker profile applies to every element", () => {
    const rows = resolveHeroElements(SAMPLE, {
      docker: true,
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
      docker: true,
      sqlDriver: "postgres",
      kvDriver: "redis",
      version: "0.2.4",
      nodeEnv: "development",
    });
    expect(snap.profile).toBe("docker");
    expect(snap.runtimeEnv).toBe("local");
    expect(decodeHeroSnapshot(encodeHeroSnapshot(snap))).toEqual(snap);
  });
});
