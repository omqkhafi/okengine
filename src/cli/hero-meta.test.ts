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
      sql: { dev: "postgres", test: "pglite", prod: "postgres" },
      kv: { dev: "redis", test: "memory", prod: "redis" },
    },
    signal: { dev: "redis", test: "memory", prod: "redis" },
    clock: { dev: "file", test: "memory", prod: "file" },
    vault: { dev: "vault", test: "env", prod: "vault" },
    channel: {
      email: { dev: "smtp", test: "console", prod: "smtp" },
    },
    ai: { dev: "mock", test: "mock" },
  },
};

describe("hero-meta", () => {
  test("resolveDevProfile maps NODE_ENV (docker flag ignored)", () => {
    expect(resolveDevProfile({ docker: false })).toBe("dev");
    expect(resolveDevProfile({ docker: true })).toBe("dev");
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
    expect(rows.find((r) => r.element === "store")?.detail).toContain("pglite");
    expect(rows.find((r) => r.element === "flow")?.detail).toBe("");
    expect(rows.find((r) => r.element === "flow")?.status).toBe("ready");
  });

  test("dev (compose) profile applies to every element", () => {
    const rows = resolveHeroElements(SAMPLE, {
      docker: true,
      sqlDriver: "postgres",
      kvDriver: "redis",
    });
    const store = rows.find((r) => r.element === "store")?.detail ?? "";
    expect(store).toContain("postgres");
    expect(store).toContain("redis");
    expect(store).not.toContain("pglite");
    expect(rows.find((r) => r.element === "signal")?.detail).toBe("redis");
    expect(rows.find((r) => r.element === "clock")?.detail).toBe("file");
    expect(rows.find((r) => r.element === "gate")?.detail).toBe("redis");
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
    expect(snap.profile).toBe("dev");
    expect(snap.runtimeEnv).toBe("dev");
    expect(decodeHeroSnapshot(encodeHeroSnapshot(snap))).toEqual(snap);
  });

  test("hero AI row includes configured model id", () => {
    const snap = buildDevHeroSnapshot({
      config: SAMPLE,
      docker: true,
      aiModel: "gemma4:e4b-q4_K_M",
      nodeEnv: "development",
    });
    const ai = snap.elements.find((r) => r.element === "ai")?.detail ?? "";
    expect(ai).toContain("gemma4:e4b-q4_K_M");
  });
});
