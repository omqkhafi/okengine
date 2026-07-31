/**
 * Fixture Gates projection for unit tests and the axe gate.
 */

import type { GatesListResponse, SimulateResponse } from "./types.ts";

/** Full list response fixture. */
export const GATES_LIST_FIXTURE: GatesListResponse = {
  moduleActions: [
    "booking:create",
    "bookings:create",
    "console:flows:invoke-as",
    "console:store.sql:read",
    "member",
    "reports:export",
  ],
  flows: [
    {
      flowId: "bookings.create",
      plane: "user",
      gates: ["member", "booking:create", "rate:sliding-window-counter:300/1m"],
      unguarded: false,
      explicitPublic: false,
    },
    {
      flowId: "health.ping",
      plane: "user",
      gates: [],
      unguarded: true,
      explicitPublic: false,
    },
    {
      flowId: "reports.export",
      plane: "user",
      gates: ["staff"],
      unguarded: false,
      explicitPublic: false,
    },
    {
      flowId: "console.store.query",
      plane: "operator",
      gates: [],
      unguarded: false,
      explicitPublic: false,
    },
  ],
  gates: [
    {
      name: "booking:create",
      kind: "policy",
      scopes: ["booking:create"],
      roles: [],
      overridable: false,
      attachedTo: ["bookings.create"],
    },
    {
      name: "member",
      kind: "policy",
      scopes: [],
      roles: [],
      overridable: false,
      attachedTo: ["bookings.create"],
    },
    {
      name: "rate:sliding-window-counter:300/1m",
      kind: "rate",
      scopes: [],
      roles: [],
      strategy: "sliding-window-counter",
      max: 300,
      per: "1m",
      keyBy: "user",
      overridable: false,
      attachedTo: ["bookings.create"],
    },
    {
      name: "staff",
      kind: "policy",
      scopes: [],
      roles: ["staff"],
      overridable: false,
      attachedTo: ["reports.export"],
    },
    {
      name: "unusedGate",
      kind: "policy",
      scopes: [],
      roles: [],
      overridable: false,
      attachedTo: [],
    },
  ],
  principals: [
    {
      kind: "role",
      id: "role_member",
      name: "member",
      plane: "user",
      scopes: ["booking:create", "member"],
      memberCount: 2,
    },
    {
      kind: "role",
      id: "role_staff",
      name: "staff",
      plane: "user",
      scopes: ["booking:create", "member", "reports:export", "staff"],
      memberCount: 0,
    },
    {
      kind: "key",
      id: "key_demo",
      name: "Demo key",
      plane: "user",
      scopes: ["booking:create", "member"],
    },
    {
      kind: "user",
      id: "user_demo",
      name: "Demo User",
      plane: "user",
      scopes: ["booking:create", "member"],
      email: "demo@example.com",
    },
  ],
  violations: [
    {
      kind: "operator-application-scope",
      operatorId: "op_bad",
      name: "Bad Ops",
      email: "bad@example.com",
      applicationScopes: ["booking:create"],
    },
  ],
  audit: {
    unguardedFlows: ["health.ping"],
    orphanPermissions: ["reports:export"],
    emptyRoles: ["role_staff"],
    unattachedGates: ["unusedGate"],
  },
  widenings: [
    {
      path: "/flows/reports.export/gates",
      category: "permission-widening",
      kind: "changed",
      summary: "gate removed: staff",
    },
  ],
};

/** Simulator denial fixture — RateLimited shape. */
export const SIMULATE_RATE_FIXTURE: SimulateResponse = {
  flowId: "bookings.create",
  gates: ["member", "booking:create", "rate:sliding-window-counter:300/1m"],
  evaluations: [
    { name: "member", allowed: true, kind: "policy" },
    { name: "booking:create", allowed: true, kind: "policy" },
    {
      name: "rate:sliding-window-counter:300/1m",
      allowed: false,
      kind: "rate",
      remaining: 0,
      retryAfterMs: 12_000,
      reason: "rate limited",
    },
  ],
  deniedAt: "rate:sliding-window-counter:300/1m",
  denial: {
    code: "RateLimited",
    data: { retryAfterMs: 12_000 },
    status: 429,
  },
  allowed: false,
};

/** Simulator allow fixture. */
export const SIMULATE_ALLOW_FIXTURE: SimulateResponse = {
  flowId: "bookings.create",
  gates: ["member", "booking:create", "rate:sliding-window-counter:300/1m"],
  evaluations: [
    { name: "member", allowed: true, kind: "policy" },
    { name: "booking:create", allowed: true, kind: "policy" },
    {
      name: "rate:sliding-window-counter:300/1m",
      allowed: true,
      kind: "rate",
      remaining: 299,
    },
  ],
  deniedAt: null,
  denial: null,
  allowed: true,
};
