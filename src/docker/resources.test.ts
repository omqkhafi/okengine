/**
 * Server budget → per-service resource allocation.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SERVER_BUDGET,
  allocateServiceResources,
  mergeDeployResources,
  resolveServerBudget,
} from "./resources.ts";

describe("resolveServerBudget", () => {
  test("defaults to 4 CPU / 8 GiB", () => {
    expect(resolveServerBudget(undefined)).toEqual(DEFAULT_SERVER_BUDGET);
    expect(DEFAULT_SERVER_BUDGET).toEqual({ cpus: 4, memoryGb: 8 });
  });

  test("accepts client overrides", () => {
    expect(resolveServerBudget({ cpus: 8, memoryGb: 16 })).toEqual({
      cpus: 8,
      memoryGb: 16,
    });
  });
});

describe("allocateServiceResources", () => {
  test("apportion 4/8 across app + sql + kv without exceeding the usable pool", () => {
    const limits = allocateServiceResources(["app", "store-sql", "store-kv"], {
      cpus: 4,
      memoryGb: 8,
    });
    expect(limits.size).toBe(3);
    let cpuSum = 0;
    let memSum = 0;
    for (const limit of limits.values()) {
      cpuSum += Number(limit.cpus);
      memSum += limit.memory.endsWith("G")
        ? Number(limit.memory.slice(0, -1)) * 1024
        : Number(limit.memory.slice(0, -1));
    }
    // 10% host overhead → usable 3.6 CPU / ~7372 MiB
    expect(cpuSum).toBeLessThanOrEqual(3.6 + 0.05);
    expect(memSum).toBeLessThanOrEqual(8 * 1024 * 0.9 + 8);
    expect(Number(limits.get("store-sql")!.cpus)).toBeGreaterThan(
      Number(limits.get("store-kv")!.cpus),
    );
  });

  test("mergeDeployResources preserves GPU reservations", () => {
    const merged = mergeDeployResources(
      { cpus: "1.5", memory: "2G" },
      {
        resources: {
          reservations: {
            devices: [{ driver: "nvidia", count: 1, capabilities: ["gpu"] }],
          },
        },
      },
    );
    const resources = merged.resources as {
      limits: { cpus: string; memory: string };
      reservations: { devices: unknown[]; cpus: string; memory: string };
    };
    expect(resources.limits).toEqual({ cpus: "1.5", memory: "2G" });
    expect(resources.reservations.devices).toEqual([
      { driver: "nvidia", count: 1, capabilities: ["gpu"] },
    ]);
    expect(resources.reservations.cpus).toBe("0.75");
  });
});
