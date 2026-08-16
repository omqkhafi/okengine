/**
 * Health strip projection — empty tones when a source has no observation.
 */

import { describe, expect, test } from "bun:test";
import type { StoreListStore } from "@/client.ts";
import { formatVaultBackend } from "@/features/vault/lib/backend.ts";
import { healthCells, latestReplicaLagAcrossStores } from "./health-cells.ts";
import { monitoringRun } from "./run-fixture.ts";

const emptyWillNot = { writerFlowIds: [], signals: [], channels: [] };
const emptyCache = {
  producedByRead: "cache:sql:bookings",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

const store: StoreListStore = {
  ref: "sql:db",
  facet: "sql",
  name: "db",
  children: [
    {
      name: "bookings",
      effectRef: "sql:bookings",
      writers: [],
      readers: [],
      cache: emptyCache,
      willNotFire: emptyWillNot,
      piiColumns: [],
      columnDescriptions: {},
    },
  ],
  replicaLagMs: null,
  migrationDrift: { declared: "a", applied: "b", drifted: true },
  contentAddressed: false,
  warnings: [],
};

describe("healthCells", () => {
  test("uses empty tones when sources have no observation", () => {
    const cells = healthCells({
      vaultCard: null,
      stores: [],
      runs: [],
      crons: [],
      signals: [],
      window: { kind: "empty" },
      liveStatus: "connecting",
    });
    expect(cells.map((c) => [c.id, c.tone, c.value])).toEqual([
      ["vault", "empty", "no backend"],
      ["drift", "empty", "no stores"],
      ["lag", "empty", "no lag observed"],
      ["clock", "empty", "no crons"],
      ["signal", "empty", "no signals"],
      ["window", "empty", "no recent runs"],
      ["live", "empty", "connecting"],
    ]);
  });

  test("surfaces real vault / drift / overdue / dead / window values", () => {
    const card = formatVaultBackend({
      driverId: "vault",
      builtin: true,
      status: {
        initialized: true,
        sealed: true,
        masterKeyPresent: false,
        kekVersion: 2,
        secretCount: 1,
        sealCount: 1,
        lastSealedAt: null,
        lastUnsealedAt: null,
        rewrapTargetKekVersion: null,
      },
      unavailable: null,
      provider: null,
    });
    const cells = healthCells({
      vaultCard: card,
      stores: [store],
      runs: [
        monitoringRun({
          id: "r1",
          flow: "a",
          startedAt: 10,
          replicaLagMs: 400,
          effects: [
            {
              kind: "read",
              resource: "sql:bookings",
              timestamp: 10,
              duration: 1,
              reversibility: "none",
            },
          ],
        }),
      ],
      crons: [
        {
          name: "tick",
          status: "active",
          health: { driftMs: 12, overdue: true, missedRuns: 2, catchUp: "one" },
        },
      ],
      signals: [{ name: "orders", pending: 0, inflight: 0, dead: 3, outboxLagMs: null }],
      window: {
        kind: "summary",
        total: 4,
        errors: 1,
        errorRate: 0.25,
        p50Ms: 10,
        p95Ms: 40,
        p99Ms: 40,
        from: 0,
        to: 1,
        windowMs: 60_000,
      },
      liveStatus: "open",
    });
    expect(cells.find((c) => c.id === "vault")).toMatchObject({ tone: "warn", value: "sealed" });
    expect(cells.find((c) => c.id === "drift")).toMatchObject({ tone: "warn", value: "1 drifted" });
    expect(cells.find((c) => c.id === "lag")).toMatchObject({ tone: "warn", value: "400ms" });
    expect(cells.find((c) => c.id === "clock")).toMatchObject({
      tone: "warn",
      value: "1 overdue",
    });
    expect(cells.find((c) => c.id === "signal")).toMatchObject({ tone: "warn", value: "3 dead" });
    expect(cells.find((c) => c.id === "window")?.value).toContain("25% err");
    expect(cells.find((c) => c.id === "live")).toMatchObject({ tone: "ok", value: "live" });
  });
});

describe("latestReplicaLagAcrossStores", () => {
  test("uses newest matching run, not max lag", () => {
    const runs = [
      monitoringRun({
        id: "old",
        flow: "a",
        startedAt: 1,
        replicaLagMs: 900,
        effects: [
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: 1,
            duration: 1,
            reversibility: "none",
          },
        ],
      }),
      monitoringRun({
        id: "new",
        flow: "a",
        startedAt: 9,
        replicaLagMs: 12,
        effects: [
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: 9,
            duration: 1,
            reversibility: "none",
          },
        ],
      }),
    ];
    expect(latestReplicaLagAcrossStores(runs, [store])).toBe(12);
  });
});
