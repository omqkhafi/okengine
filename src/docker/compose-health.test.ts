import { describe, expect, test } from "bun:test";
import {
  composeHealthByService,
  composeRowToStatus,
  parseComposePsJson,
  startComposeHealthWatch,
  watchComposeHealth,
} from "./compose-health.ts";

describe("compose-health", () => {
  test("composeRowToStatus maps Health and State", () => {
    expect(composeRowToStatus({ Health: "healthy", State: "running" })).toBe("ready");
    expect(composeRowToStatus({ Health: "starting", State: "running" })).toBe("pending");
    expect(composeRowToStatus({ Health: "unhealthy", State: "running" })).toBe("error");
    expect(composeRowToStatus({ State: "exited" })).toBe("error");
    expect(composeRowToStatus({ State: "stopped" })).toBe("error");
    expect(composeRowToStatus({ Status: "Exited (0) 3 seconds ago" })).toBe("error");
    expect(composeRowToStatus({ State: "running" })).toBe("ready");
    expect(composeRowToStatus({ Status: "Up 2 seconds (health: starting)" })).toBe("pending");
  });

  test("parseComposePsJson accepts NDJSON and arrays", () => {
    const nd = [
      JSON.stringify({ Service: "ai", Health: "starting", State: "running" }),
      JSON.stringify({ Service: "store-sql", Health: "healthy", State: "running" }),
    ].join("\n");
    expect(parseComposePsJson(nd)).toHaveLength(2);

    const arr = JSON.stringify([
      { Service: "redis", State: "running" },
      { Service: "vault", Health: "unhealthy", State: "running" },
    ]);
    const map = composeHealthByService(arr);
    expect(map.get("redis")).toBe("ready");
    expect(map.get("vault")).toBe("error");
  });

  test("watchComposeHealth emits changes until done", async () => {
    let calls = 0;
    const updates: string[] = [];
    const map = await watchComposeHealth({
      files: ["compose.yml"],
      cwd: "/tmp",
      env: {},
      intervalMs: 1,
      timeoutMs: 5_000,
      sleep: async () => {},
      run: async () => {
        calls += 1;
        if (calls === 1) {
          return JSON.stringify([{ Service: "store-sql", Health: "starting", State: "running" }]);
        }
        return JSON.stringify([{ Service: "store-sql", Health: "healthy", State: "running" }]);
      },
      onUpdate: (service, status) => {
        updates.push(`${service}:${status}`);
      },
    });
    expect(map.get("store-sql")).toBe("ready");
    expect(updates).toEqual(["store-sql:pending", "store-sql:ready"]);
  });

  test("readComposeHealth / watch use ps -a", async () => {
    let seen: readonly string[] = [];
    await watchComposeHealth({
      files: ["compose.yml"],
      cwd: "/tmp",
      env: {},
      intervalMs: 1,
      timeoutMs: 1,
      sleep: async () => {},
      run: async (args) => {
        seen = args;
        return JSON.stringify([{ Service: "ai", State: "exited", Status: "Exited (0) 1s ago" }]);
      },
      isDone: () => true,
    });
    expect(seen).toContain("-a");
  });

  test("startComposeHealthWatch reports ready → error", async () => {
    let calls = 0;
    const changes: string[] = [];
    let stopWatch: (() => void) | undefined;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("health watch timeout")), 2_000);
      stopWatch = startComposeHealthWatch({
        files: ["compose.yml"],
        cwd: "/tmp",
        env: {},
        intervalMs: 1,
        sleep: async () => {},
        run: async () => {
          calls += 1;
          if (calls === 1) {
            return JSON.stringify([{ Service: "ai", Health: "healthy", State: "running" }]);
          }
          return JSON.stringify([
            { Service: "ai", State: "exited", Status: "Exited (0) 1 second ago" },
          ]);
        },
        onChange: (_map, changed) => {
          for (const c of changed) changes.push(`${c.service}:${c.status}`);
          if (changes.includes("ai:ready") && changes.includes("ai:error")) {
            clearTimeout(timer);
            stopWatch?.();
            resolve();
          }
        },
      });
    });
    expect(changes).toContain("ai:ready");
    expect(changes).toContain("ai:error");
  });
});
