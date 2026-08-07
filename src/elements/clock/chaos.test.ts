/**
 * Clock chaos — multi-process leader election + SIGKILL durable resume.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { flow } from "../../kernel/flow.ts";
import { createFileJournalStore } from "../../kernel/journal.ts";
import { runDurable } from "./durable.ts";

const childPath = join(import.meta.dir, "chaos-child.ts");

async function waitForFile(path: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return true;
    await Bun.sleep(10);
  }
  return false;
}

describe("chaos — multi-process leader election", () => {
  test("two OS processes sharing a file CronStore fire exactly once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clock-leader-"));
    const storePath = join(dir, "crons.json");
    const fireLogPath = join(dir, "fires.jsonl");
    const leaseMs = 200;
    try {
      const a = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "tick-loop",
          storePath,
          "inst-a",
          fireLogPath,
          String(leaseMs),
          "1h",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      const b = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "tick-loop",
          storePath,
          "inst-b",
          fireLogPath,
          String(leaseMs),
          "1h",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      // Stop as soon as exactly one fire is observed; kill stragglers.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await Bun.file(fireLogPath).exists()) {
          const text = await Bun.file(fireLogPath).text();
          if (text.trim().split("\n").filter(Boolean).length >= 1) break;
        }
        await Bun.sleep(10);
      }
      a.kill(9);
      b.kill(9);
      await Promise.all([a.exited, b.exited]);

      expect(await Bun.file(fireLogPath).exists()).toBe(true);
      const lines = (await Bun.file(fireLogPath).text()).trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const fire = JSON.parse(lines[0]!) as { instanceId: string };
      expect(["inst-a", "inst-b"]).toContain(fire.instanceId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("SIGKILL leader mid-lease: survivor takes over; report real latency", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clock-takeover-"));
    const storePath = join(dir, "crons.json");
    const markerPath = join(dir, "held.json");
    const fireLogPath = join(dir, "fires.jsonl");
    const leaseMs = 120;
    const tickSlackMs = 250;
    try {
      const leader = Bun.spawn({
        cmd: ["bun", childPath, "hold-lease", storePath, "leader", markerPath, String(leaseMs)],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await waitForFile(markerPath)).toBe(true);
      const held = (await Bun.file(markerPath).json()) as {
        leaderLeaseUntil?: number;
        heldAt: number;
      };

      const killAt = Date.now();
      leader.kill(9);
      await leader.exited;

      // every=50ms so the schedule is due again once the dead leader's lease expires.
      const survivor = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "tick-loop",
          storePath,
          "survivor",
          fireLogPath,
          String(leaseMs),
          "50ms",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await survivor.exited).toBe(0);

      expect(await Bun.file(fireLogPath).exists()).toBe(true);
      const lines = (await Bun.file(fireLogPath).text()).trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const fire = JSON.parse(lines[0]!) as { instanceId: string; firedAt: number };
      expect(fire.instanceId).toBe("survivor");

      const takeoverMs = fire.firedAt - killAt;
      // Physics: cannot take over before the leader's lease expires.
      const leaseRemainingAtKill = Math.max(
        0,
        (held.leaderLeaseUntil ?? killAt + leaseMs) - killAt,
      );
      expect(takeoverMs).toBeGreaterThanOrEqual(Math.max(0, leaseRemainingAtKill - 20));
      // Upper bound: lease TTL + tick/poll slack (not a product SLA).
      expect(takeoverMs).toBeLessThanOrEqual(leaseMs + tickSlackMs);

      // Evidence for docs / later SLA choice — real measured latency.
      console.log(
        `[clock takeover] measured=${takeoverMs}ms leaseMs=${leaseMs} leaseRemainingAtKill=${leaseRemainingAtKill}ms`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("chaos — SIGKILL durable mid-step", () => {
  test("SIGKILL after step 1: resume skips completed step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clock-durable-kill-"));
    const journalPath = join(dir, "journal.json");
    const markerPath = join(dir, "step1");
    const runIdPath = join(dir, "runId");
    try {
      const child = Bun.spawn({
        cmd: ["bun", childPath, "durable-mid-step", journalPath, markerPath, runIdPath],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await waitForFile(markerPath)).toBe(true);
      expect(await waitForFile(runIdPath)).toBe(true);
      // Give the journal a moment to flush step 1 after the marker write.
      await Bun.sleep(50);
      child.kill(9);
      await child.exited;

      const runId = (await Bun.file(runIdPath).text()).trim();
      expect(runId.length).toBeGreaterThan(0);

      const calls: string[] = [];
      const journalStore = createFileJournalStore(journalPath);
      const charge = flow("chaos.charge", {
        durable: true,
        do: async (_input, fx) => {
          const intent = await fx.step("create-intent", () => {
            calls.push("create-intent");
            return { id: "pi_chaos" };
          });
          return fx.step("confirm", () => {
            calls.push("confirm");
            return intent.id === "pi_chaos";
          });
        },
      });

      const resumed = await runDurable({
        flow: charge,
        input: { orderId: "o-chaos" },
        journalStore,
        runId,
      });
      expect(resumed.status).toBe("completed");
      // create-intent must not re-run; confirm runs once.
      expect(calls).toEqual(["confirm"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
