/**
 * Fixture Plugins projection for unit tests and the axe gate.
 */

import type { PluginsListResponse, SupplyChainRecord } from "./types.ts";

/** N/A supply-chain strip for core/local. */
export const SUPPLY_CHAIN_CORE_NA: SupplyChainRecord = {
  lifecycleScripts: {
    state: "not-applicable",
    scripts: [],
    detail: "Lifecycle scripts apply to community packages only (core)",
  },
  releaseCooldown: {
    state: "not-applicable",
    publishedAt: null,
    holdUntil: null,
    detail: "Release cooldown applies to community registry packages only (core)",
  },
  nodeImportScan: {
    state: "pass",
    findings: [],
    detail: "No direct node:/bun: imports detected",
  },
  npmProvenance: {
    state: "not-applicable",
    detail: "npm provenance applies to community registry packages only (core)",
  },
  bootConflicts: {
    state: "clean",
    conflicts: [],
    detail: "No boot-time naming conflicts detected",
  },
};

/** Community supply-chain with mixed real signals. */
export const SUPPLY_CHAIN_COMMUNITY: SupplyChainRecord = {
  lifecycleScripts: {
    state: "pass",
    scripts: [],
    detail: "No install/prepare lifecycle scripts",
  },
  releaseCooldown: {
    state: "hold",
    publishedAt: 1_700_000_000_000,
    holdUntil: 1_700_259_200_000,
    detail: "Published within cooldown — held until 2023-11-18T00:00:00.000Z",
  },
  nodeImportScan: {
    state: "fail",
    findings: [
      {
        source: "index.ts",
        specifier: "node:fs",
        line: 2,
      },
    ],
    detail: "1 direct node:/bun: import(s) bypassing fx",
  },
  npmProvenance: {
    state: "unknown",
    detail: "Provenance unknown (offline or non-npm)",
  },
  bootConflicts: {
    state: "clean",
    conflicts: [],
    detail: "No boot-time naming conflicts detected",
  },
};

/** Full list fixture — CORE catalogue + one local + one community. */
export const PLUGINS_LIST_FIXTURE: PluginsListResponse = {
  stateDerivation:
    "CORE auth/console/rate-limit: on iff `.plug()`-ed (Manifest/registry). CORE tenancy: on iff oke.config.ts has `tenancy: {…}` (or Manifest.tenancy). CORE privacy: on iff oke.config.ts has `privacy` or top-level `runs.redact`. local/community: listed only when present via `.plug()` / Manifest.plugins.",
  plugins: [
    {
      id: "auth",
      origin: "core",
      state: "on",
      version: "0.0.1",
      summary: "Hybrid session, two planes, roles as data",
      scopes: [{ kind: "app" }],
      declares: ["table:oke_identities", "table:oke_operators"],
      tables: {},
      intercepts: [{ stage: "onAuth", meanMs: 0.4, count: 12 }],
      hookCost: {
        count: 12,
        meanMs: 0.4,
        p50Ms: 0.35,
        p95Ms: 0.9,
        lastMs: 0.42,
      },
      supplyChain: SUPPLY_CHAIN_CORE_NA,
      capabilityDiff: [],
      installCommand: null,
      enableHint: null,
      packageName: null,
    },
    {
      id: "console",
      origin: "core",
      state: "on",
      version: "0.0.1",
      summary: "Operator Console on :6533",
      scopes: [{ kind: "app" }],
      declares: ["consolePanel:overview", "consolePanel:traces", "table:oke_console_prefs"],
      tables: {},
      intercepts: [{ stage: "beforeHandle", meanMs: 0.2, count: 40 }],
      hookCost: {
        count: 40,
        meanMs: 0.2,
        p50Ms: 0.18,
        p95Ms: 0.5,
        lastMs: 0.21,
      },
      supplyChain: SUPPLY_CHAIN_CORE_NA,
      capabilityDiff: [],
      installCommand: null,
      enableHint: null,
      packageName: null,
    },
    {
      id: "rate-limit",
      origin: "core",
      state: "off",
      version: null,
      summary: "Attachment-scoped request rate limits",
      scopes: [],
      declares: [],
      tables: {},
      intercepts: [],
      hookCost: null,
      supplyChain: SUPPLY_CHAIN_CORE_NA,
      capabilityDiff: [],
      installCommand: null,
      enableHint: "app.plug(rateLimit({ max: 30 }))  // or unit.plug / flow.plug",
      packageName: null,
    },
    {
      id: "tenancy",
      origin: "core",
      state: "off",
      version: null,
      summary: "Multi-tenant isolation (row · schema · database)",
      scopes: [],
      declares: [],
      tables: {},
      intercepts: [],
      hookCost: null,
      supplyChain: SUPPLY_CHAIN_CORE_NA,
      capabilityDiff: [],
      installCommand: null,
      enableHint: 'oke.config.ts → tenancy: { isolation: "row", resolve: … }',
      packageName: null,
    },
    {
      id: "privacy",
      origin: "core",
      state: "off",
      version: null,
      summary: "PII classification, redact, export/erase tooling",
      scopes: [],
      declares: [],
      tables: {},
      intercepts: [],
      hookCost: null,
      supplyChain: SUPPLY_CHAIN_CORE_NA,
      capabilityDiff: [],
      installCommand: null,
      enableHint: "oke.config.ts → privacy: { … }  // or runs: { redact: { … } }",
      packageName: null,
    },
    {
      id: "audit",
      origin: "local",
      state: "on",
      version: "1.0.0",
      summary: null,
      scopes: [{ kind: "app" }],
      declares: ["consolePanel:audit", "table:oke_audit"],
      tables: {},
      intercepts: [{ stage: "afterHandle", meanMs: 1.2, count: 8 }],
      hookCost: {
        count: 8,
        meanMs: 1.2,
        p50Ms: 1.1,
        p95Ms: 2.0,
        lastMs: 1.3,
      },
      supplyChain: {
        ...SUPPLY_CHAIN_CORE_NA,
        lifecycleScripts: {
          state: "not-applicable",
          scripts: [],
          detail: "Lifecycle scripts apply to community packages only (local)",
        },
        releaseCooldown: {
          state: "not-applicable",
          publishedAt: null,
          holdUntil: null,
          detail: "Release cooldown applies to community registry packages only (local)",
        },
        npmProvenance: {
          state: "not-applicable",
          detail: "npm provenance applies to community registry packages only (local)",
        },
      },
      capabilityDiff: [
        {
          path: "/plugins/audit",
          category: "permission-widening",
          kind: "changed",
          summary: "plugin capabilities widened: afterHandle",
        },
      ],
      installCommand: null,
      enableHint: null,
      packageName: null,
    },
    {
      id: "oke-slack",
      origin: "community",
      state: "on",
      version: "2.1.0",
      summary: null,
      scopes: [{ kind: "app" }],
      declares: ["channel:slack"],
      tables: {},
      intercepts: [{ stage: "onResponse", meanMs: null, count: 0 }],
      hookCost: null,
      supplyChain: SUPPLY_CHAIN_COMMUNITY,
      capabilityDiff: [],
      installCommand: "bun add oke-slack",
      enableHint: null,
      packageName: "oke-slack",
    },
  ],
};
