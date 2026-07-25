/**
 * Console Gates projection — two inquiries, simulator, continuous audit
 * (console §9.7).
 *
 * The simulator evaluates the real gate chain via {@link GateRuntime.check}
 * only — never the flow handler, never application data. Rate takes use an
 * ephemeral memory KV so production counters are untouched.
 */

import {
  createApiKeyStore,
  createRoleStore,
  listRoleGrants,
  scopesForRoles,
  setRoleGrants,
  upsertRole,
  type ApiKeyStore,
  type RoleStore,
} from "../../auth/index.ts";
import { memoryKvDriver } from "../../drivers/memory.ts";
import {
  createGateRuntime,
  deriveModuleActions,
  gate,
  type GateDecl,
  type GateEvaluation,
  type GatePolicyContext,
  type GateRuntime,
  type RateGateDecl,
} from "../../elements/gate.ts";
import { statusForFailure } from "../../compiler/response.ts";
import { gateDenialFailure } from "../../kernel/index.ts";
import { diffManifest, type ManifestChange } from "../../manifest/diff.ts";
import type { Gate as ManifestGate, Manifest } from "../../manifest/types.ts";

/** Identity slice needed for Gates (avoids circular import with state). */
export interface GatesIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly scopes: readonly string[];
}

/** Principal kinds in the Gates inquiry (console §9.7). */
export type GatePrincipalKind = "role" | "key" | "user";

/** One Module:Action / flow / gate surface row. */
export interface ConsoleGateDefRow {
  readonly name: string;
  readonly kind: "policy" | "rate";
  readonly scopes: readonly string[];
  readonly roles: readonly string[];
  readonly strategy?: string;
  readonly max?: number;
  readonly per?: string;
  readonly keyBy?: string;
  readonly overridable: boolean;
  /** Flow ids that attach this gate (registration order preserved per flow). */
  readonly attachedTo: readonly string[];
}

/** One flow's gate chain in registration order. */
export interface ConsoleFlowGatesRow {
  readonly flowId: string;
  readonly plane: "user" | "operator";
  readonly gates: readonly string[];
  /** User-plane with empty chain — public. */
  readonly unguarded: boolean;
}

/**
 * A principal shown as a normal row.
 * Operators holding application scopes never appear here — see violations.
 */
export interface ConsolePrincipalRow {
  readonly kind: GatePrincipalKind;
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly string[];
  /** Role membership count (roles only). */
  readonly memberCount?: number;
  readonly email?: string;
}

/** Operator holding an application scope — violation, never a normal row. */
export interface ConsolePlaneViolation {
  readonly kind: "operator-application-scope";
  readonly operatorId: string;
  readonly name: string;
  readonly email: string;
  readonly applicationScopes: readonly string[];
}

/** Continuous security audit findings (console §9.7). */
export interface ConsoleGateAudit {
  readonly unguardedFlows: readonly string[];
  readonly orphanPermissions: readonly string[];
  readonly emptyRoles: readonly string[];
  readonly unattachedGates: readonly string[];
}

/** Full Gates panel projection. */
export interface GatesPanelProjection {
  readonly moduleActions: readonly string[];
  readonly flows: readonly ConsoleFlowGatesRow[];
  readonly gates: readonly ConsoleGateDefRow[];
  readonly principals: readonly ConsolePrincipalRow[];
  readonly violations: readonly ConsolePlaneViolation[];
  readonly audit: ConsoleGateAudit;
  readonly widenings: readonly ManifestChange[];
}

/** Input to the evaluate-only simulator. */
export interface SimulateGatesInput {
  readonly flowId: string;
  readonly principal: {
    readonly kind: GatePrincipalKind;
    readonly id: string;
  };
  readonly meta?: {
    readonly ip?: string;
  };
}

/** Typed denial the client would receive. */
export interface SimulateGateDenial {
  readonly code: "Unauthorized" | "Forbidden" | "RateLimited";
  readonly data: Readonly<Record<string, unknown>>;
  readonly status: 401 | 403 | 429;
}

/** Simulator result — ordered evaluations + first denial. */
export interface SimulateGatesResult {
  readonly flowId: string;
  readonly gates: readonly string[];
  readonly evaluations: readonly GateEvaluation[];
  readonly deniedAt: string | null;
  readonly denial: SimulateGateDenial | null;
  readonly allowed: boolean;
}

/** Options for {@link projectGatesPanel}. */
export interface ProjectGatesOptions {
  readonly manifest: Manifest | null;
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly identities: readonly GatesIdentity[];
  /** operatorId → role ids. */
  readonly operatorRoles: ReadonlyMap<string, readonly string[]>;
  /** operatorId → { name, email }. */
  readonly operators: ReadonlyMap<
    string,
    { readonly name: string; readonly email: string }
  >;
  /** roleId → member principal ids (users + operators). */
  readonly roleMembers: ReadonlyMap<string, readonly string[]>;
  /** Previous Manifest for deploy-diff widenings (optional). */
  readonly previousManifest?: Manifest | null;
}

/** Options for {@link simulateGates}. */
export interface SimulateGatesOptions extends SimulateGatesInput {
  readonly manifest: Manifest | null;
  /** Live GateRuntime from boot (A) — preferred. */
  readonly gateRuntime: GateRuntime | null;
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly identities: readonly GatesIdentity[];
  readonly now?: () => number;
}

/**
 * Whether a Module:Action is an application (user-plane) scope.
 * Console scopes are `console:*` (console §3.4 · §9.7 · §9.14).
 *
 * @param action - Module:Action pair
 */
export function isApplicationScope(action: string): boolean {
  return !action.startsWith("console:");
}

/**
 * Project Manifest + auth data into the Gates panel.
 *
 * @param options - Manifest, roles, keys, identities, operators
 */
export function projectGatesPanel(
  options: ProjectGatesOptions,
): GatesPanelProjection {
  const manifest = options.manifest;
  const moduleActions = manifest ? deriveModuleActions(manifest) : [];
  const flows = projectFlows(manifest);
  const gates = projectGateDefs(manifest, flows);
  const { principals, violations } = projectPrincipals(options);
  const audit = buildAudit({
    moduleActions,
    flows,
    gates,
    roles: options.roles,
    roleMembers: options.roleMembers,
  });
  const widenings = projectWidenings(
    options.previousManifest ?? null,
    manifest,
  );

  return {
    moduleActions,
    flows,
    gates,
    principals,
    violations,
    audit,
    widenings,
  };
}

/**
 * Simulate one call: evaluate the flow's gate chain in registration order
 * via the real GateRuntime, stop at first denial, map to the typed client
 * error. Never invokes the flow handler.
 *
 * @param options - Flow, principal, runtime
 */
export async function simulateGates(
  options: SimulateGatesOptions,
): Promise<SimulateGatesResult> {
  const flow = options.manifest?.flows?.[options.flowId];
  if (!flow) {
    return {
      flowId: options.flowId,
      gates: [],
      evaluations: [],
      deniedAt: null,
      denial: {
        code: "Forbidden",
        data: { gate: options.flowId, reason: "unknown flow" },
        status: 403,
      },
      allowed: false,
    };
  }

  const names = [...(flow.gates ?? [])];
  const resolved = resolvePrincipalContext(options);
  if (!resolved) {
    return {
      flowId: options.flowId,
      gates: names,
      evaluations: [],
      deniedAt: null,
      denial: {
        code: "Unauthorized",
        data: {},
        status: 401,
      },
      allowed: false,
    };
  }

  const { runtime, close } = await openSimulationRuntime(
    options.gateRuntime,
    options.manifest,
    options.now ?? (() => Date.now()),
  );

  try {
    if (names.length === 0) {
      return {
        flowId: options.flowId,
        gates: names,
        evaluations: [],
        deniedAt: null,
        denial: null,
        allowed: true,
      };
    }

    const evaluations = await runtime.check(names, resolved.ctx);
    const denied = evaluations.find((e) => !e.allowed);
    if (!denied) {
      return {
        flowId: options.flowId,
        gates: names,
        evaluations,
        deniedAt: null,
        denial: null,
        allowed: true,
      };
    }

    const failure = gateDenialFailure(denied, resolved.ctx);
    const status = statusForFailure(failure) as 401 | 403 | 429;
    const code = failure.error.code as SimulateGateDenial["code"];
    return {
      flowId: options.flowId,
      gates: names,
      evaluations,
      deniedAt: denied.name,
      denial: {
        code,
        data: (failure.error.data ?? {}) as Record<string, unknown>,
        status,
      },
      allowed: false,
    };
  } finally {
    await close();
  }
}

/**
 * What a principal can do — scopes plus flows whose full gate chain allows.
 *
 * @param options - Principal + runtime context
 */
export async function powersForPrincipal(options: {
  readonly kind: GatePrincipalKind;
  readonly id: string;
  readonly manifest: Manifest | null;
  readonly gateRuntime: GateRuntime | null;
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly identities: readonly GatesIdentity[];
  readonly now?: () => number;
}): Promise<{
  readonly scopes: readonly string[];
  readonly allowedFlowIds: readonly string[];
  readonly deniedFlowIds: readonly string[];
}> {
  const flows = projectFlows(options.manifest);
  let scopes: string[] = [];
  if (options.kind === "user") {
    scopes = [
      ...(options.identities.find((u) => u.id === options.id)?.scopes ?? []),
    ];
  } else if (options.kind === "role") {
    scopes = [...(options.roles.grants.get(options.id) ?? [])];
  } else {
    scopes = [...(options.apiKeys.keys.get(options.id)?.scopes ?? [])];
  }
  scopes.sort((a, b) => a.localeCompare(b));

  const allowedFlowIds: string[] = [];
  const deniedFlowIds: string[] = [];

  for (const flow of flows) {
    // User/key inquiry is application power; skip operator-plane flows.
    if (
      flow.plane === "operator" &&
      (options.kind === "user" || options.kind === "key")
    ) {
      continue;
    }
    const result = await simulateGates({
      flowId: flow.flowId,
      principal: { kind: options.kind, id: options.id },
      manifest: options.manifest,
      gateRuntime: options.gateRuntime,
      roles: options.roles,
      apiKeys: options.apiKeys,
      identities: options.identities,
      now: options.now,
    });
    if (result.allowed) allowedFlowIds.push(flow.flowId);
    else deniedFlowIds.push(flow.flowId);
  }

  return { scopes, allowedFlowIds, deniedFlowIds };
}

/**
 * Build a GateRuntime from Manifest gate defs when no live runtime is bound.
 * Policy predicates honour scopes / verified — rate gates use real strategies.
 *
 * @param manifest - Manifest snapshot
 * @param now - Clock
 */
export async function createManifestGateRuntime(
  manifest: Manifest,
  now: () => number = () => Date.now(),
): Promise<{ readonly runtime: GateRuntime; readonly close: () => Promise<void> }> {
  const kv = await memoryKvDriver.open({
    name: `oke:gates:manifest:${crypto.randomUUID()}`,
  });
  const decls = declsFromManifest(manifest);
  return {
    runtime: createGateRuntime({ gates: decls, kv, now }),
    close: async () => {
      await kv.close();
    },
  };
}

/**
 * Seed a RoleStore + ApiKeyStore for Console / tests (console §3.2–3.3).
 */
export function createDefaultGateAuthStores(): {
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly roleMembers: Map<string, string[]>;
} {
  const roles = createRoleStore();
  upsertRole(roles, {
    id: "role_member",
    name: "member",
    plane: "user",
    description: "Verified members",
  });
  upsertRole(roles, {
    id: "role_staff",
    name: "staff",
    plane: "user",
    description: "Staff",
  });
  upsertRole(roles, {
    id: "role_ops",
    name: "ops",
    plane: "operator",
    description: "Console operators",
  });
  setRoleGrants(roles, "role_member", ["member", "booking:create"]);
  setRoleGrants(roles, "role_staff", [
    "member",
    "booking:create",
    "staff",
    "reports:export",
  ]);
  setRoleGrants(roles, "role_ops", [
    "console:store.sql:read",
    "console:store.sql:write",
    "console:flows:invoke-as",
  ]);

  const apiKeys = createApiKeyStore();
  apiKeys.keys.set("key_demo", {
    id: "key_demo",
    plane: "user",
    hash: "demo",
    name: "Demo key",
    scopes: ["member", "booking:create"],
    expiresAt: null,
    rateLimit: null,
    ipAllowlist: [],
    creatorId: "user_demo",
    creatorScopes: ["member", "booking:create"],
    createdAt: 0,
    lastUsedAt: null,
    revokedAt: null,
  });

  const roleMembers = new Map<string, string[]>([
    ["role_member", ["user_demo", "user_member"]],
    ["role_staff", []],
    ["role_ops", []],
  ]);

  return { roles, apiKeys, roleMembers };
}

// ── internals ──────────────────────────────────────────────────────────────

function projectFlows(manifest: Manifest | null): ConsoleFlowGatesRow[] {
  if (!manifest?.flows) return [];
  const rows: ConsoleFlowGatesRow[] = [];
  for (const [flowId, flow] of Object.entries(manifest.flows)) {
    const plane = flow.plane === "operator" ? "operator" : "user";
    const gates = [...(flow.gates ?? [])];
    rows.push({
      flowId,
      plane,
      gates,
      unguarded: plane === "user" && gates.length === 0,
    });
  }
  return rows.sort((a, b) => a.flowId.localeCompare(b.flowId));
}

function projectGateDefs(
  manifest: Manifest | null,
  flows: readonly ConsoleFlowGatesRow[],
): ConsoleGateDefRow[] {
  const attached = new Map<string, string[]>();
  for (const flow of flows) {
    for (const name of flow.gates) {
      const list = attached.get(name) ?? [];
      list.push(flow.flowId);
      attached.set(name, list);
    }
  }

  const rows: ConsoleGateDefRow[] = [];
  for (const [name, def] of Object.entries(manifest?.gates ?? {})) {
    const kind: "policy" | "rate" =
      def.kind === "rate" || name.startsWith("rate:") ? "rate" : "policy";
    rows.push({
      name,
      kind,
      scopes: [...(def.scopes ?? [])],
      roles: [...(def.roles ?? [])],
      strategy: def.strategy,
      max: def.max,
      per: def.per,
      keyBy: def.keyBy,
      overridable: Boolean(
        (def as ManifestGate & { overridable?: boolean }).overridable,
      ),
      attachedTo: attached.get(name) ?? [],
    });
  }

  // Gates attached on flows but missing from manifest.gates still surface.
  for (const [name, flowIds] of attached) {
    if (rows.some((r) => r.name === name)) continue;
    const kind: "policy" | "rate" = name.startsWith("rate:") ? "rate" : "policy";
    rows.push({
      name,
      kind,
      scopes: [],
      roles: [],
      overridable: false,
      attachedTo: flowIds,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function projectPrincipals(options: ProjectGatesOptions): {
  readonly principals: ConsolePrincipalRow[];
  readonly violations: ConsolePlaneViolation[];
} {
  const principals: ConsolePrincipalRow[] = [];
  const violations: ConsolePlaneViolation[] = [];

  for (const role of options.roles.roles.values()) {
    const scopes = [...(options.roles.grants.get(role.id) ?? [])].sort();
    if (role.plane === "operator") {
      const appScopes = scopes.filter(isApplicationScope);
      if (appScopes.length > 0) {
        // Role itself is poisoned — surface as violation via synthetic id.
        violations.push({
          kind: "operator-application-scope",
          operatorId: `role:${role.id}`,
          name: `role ${role.name}`,
          email: "",
          applicationScopes: appScopes,
        });
        continue;
      }
    }
    principals.push({
      kind: "role",
      id: role.id,
      name: role.name,
      plane: role.plane,
      scopes,
      memberCount: options.roleMembers.get(role.id)?.length ?? 0,
    });
  }

  for (const key of options.apiKeys.keys.values()) {
    const scopes = [...key.scopes].sort();
    if (key.plane === "operator") {
      const appScopes = scopes.filter(isApplicationScope);
      if (appScopes.length > 0) {
        violations.push({
          kind: "operator-application-scope",
          operatorId: `key:${key.id}`,
          name: key.name,
          email: "",
          applicationScopes: appScopes,
        });
        continue;
      }
    }
    principals.push({
      kind: "key",
      id: key.id,
      name: key.name,
      plane: key.plane,
      scopes,
    });
  }

  for (const user of options.identities) {
    principals.push({
      kind: "user",
      id: user.id,
      name: user.name,
      plane: "user",
      scopes: [...user.scopes].sort(),
      email: user.email,
    });
  }

  // Operators: only those with clean console scopes appear… but Access owns
  // operator listing. Gates only surfaces the violation when they hold app scopes.
  for (const [operatorId, roleIds] of options.operatorRoles) {
    const scopes = [
      ...scopesForRoles(options.roles, roleIds, "operator"),
    ].sort();
    const appScopes = scopes.filter(isApplicationScope);
    if (appScopes.length === 0) continue;
    const op = options.operators.get(operatorId);
    violations.push({
      kind: "operator-application-scope",
      operatorId,
      name: op?.name ?? operatorId,
      email: op?.email ?? "",
      applicationScopes: appScopes,
    });
  }

  principals.sort((a, b) => {
    const kindOrder = { role: 0, key: 1, user: 2 } as const;
    const d = kindOrder[a.kind] - kindOrder[b.kind];
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });

  return { principals, violations };
}

function buildAudit(options: {
  readonly moduleActions: readonly string[];
  readonly flows: readonly ConsoleFlowGatesRow[];
  readonly gates: readonly ConsoleGateDefRow[];
  readonly roles: RoleStore;
  readonly roleMembers: ReadonlyMap<string, readonly string[]>;
}): ConsoleGateAudit {
  const granted = new Set<string>();
  for (const row of listRoleGrants(options.roles)) {
    granted.add(row.action);
  }

  const orphanPermissions = options.moduleActions
    .filter((a) => !granted.has(a))
    .sort((a, b) => a.localeCompare(b));

  const emptyRoles = [...options.roles.roles.values()]
    .filter((r) => (options.roleMembers.get(r.id)?.length ?? 0) === 0)
    .map((r) => r.id)
    .sort((a, b) => a.localeCompare(b));

  const unattachedGates = options.gates
    .filter((g) => g.attachedTo.length === 0)
    .map((g) => g.name)
    .sort((a, b) => a.localeCompare(b));

  const unguardedFlows = options.flows
    .filter((f) => f.unguarded)
    .map((f) => f.flowId);

  return {
    unguardedFlows,
    orphanPermissions,
    emptyRoles,
    unattachedGates,
  };
}

function projectWidenings(
  before: Manifest | null,
  after: Manifest | null,
): ManifestChange[] {
  if (!before || !after) return [];
  const diff = diffManifest(before, after);
  return diff.changes.filter((c) => c.category === "permission-widening");
}

function resolvePrincipalContext(options: SimulateGatesOptions): {
  readonly ctx: GatePolicyContext;
} | null {
  const { kind, id } = options.principal;
  if (kind === "user") {
    const user = options.identities.find((u) => u.id === id);
    if (!user || user.status === "disabled") return null;
    return {
      ctx: {
        auth: {
          userId: user.id,
          scopes: new Set(user.scopes),
          verified: true,
        },
        operator: { id: null },
        meta: {
          ip: options.meta?.ip,
          userId: user.id,
        },
      },
    };
  }
  if (kind === "role") {
    const role = options.roles.roles.get(id);
    if (!role) return null;
    const scopes = options.roles.grants.get(id) ?? new Set();
    if (role.plane === "operator") {
      return {
        ctx: {
          auth: { userId: null, scopes: new Set(), verified: false },
          operator: { id: `role:${id}` },
          meta: { ip: options.meta?.ip },
        },
      };
    }
    return {
      ctx: {
        auth: {
          userId: `role:${id}`,
          scopes: new Set(scopes),
          verified: scopes.has("member") || scopes.size > 0,
        },
        operator: { id: null },
        meta: { ip: options.meta?.ip, userId: `role:${id}` },
      },
    };
  }
  // key
  const key = options.apiKeys.keys.get(id);
  if (!key) return null;
  if (key.plane === "operator") {
    return {
      ctx: {
        auth: { userId: null, scopes: new Set(), verified: false },
        operator: { id: `key:${id}` },
        meta: { ip: options.meta?.ip },
      },
    };
  }
  return {
    ctx: {
      auth: {
        userId: `key:${id}`,
        scopes: new Set(key.scopes),
        verified: true,
      },
      operator: { id: null },
      meta: { ip: options.meta?.ip, userId: `key:${id}` },
    },
  };
}

async function openSimulationRuntime(
  live: GateRuntime | null,
  manifest: Manifest | null,
  now: () => number,
): Promise<{
  readonly runtime: GateRuntime;
  readonly close: () => Promise<void>;
}> {
  const kv = await memoryKvDriver.open({
    name: `oke:gates:sim:${crypto.randomUUID()}`,
  });
  const decls: GateDecl[] = live
    ? [...live.gates.values()]
    : manifest
      ? declsFromManifest(manifest)
      : [];
  return {
    runtime: createGateRuntime({ gates: decls, kv, now }),
    close: async () => {
      await kv.close();
    },
  };
}

/**
 * Reconstruct GateDecl list from Manifest for Console-only boots.
 * Live apps should bind the real GateRuntime instead.
 *
 * @param manifest - Manifest
 */
export function declsFromManifest(manifest: Manifest): GateDecl[] {
  const decls: GateDecl[] = [];
  const seen = new Set<string>();

  for (const [name, def] of Object.entries(manifest.gates ?? {})) {
    seen.add(name);
    decls.push(declFromManifestGate(name, def));
  }

  // Flow-attached names missing from manifest.gates.
  for (const flow of Object.values(manifest.flows ?? {})) {
    for (const name of flow.gates ?? []) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (name.startsWith("rate:")) {
        const parsed = parseRateName(name);
        decls.push({
          kind: "rate",
          name,
          strategy: parsed.strategy,
          max: parsed.max,
          per: parsed.per,
          keyBy: "user",
          overridable: false,
        } satisfies RateGateDecl);
      } else {
        decls.push(
          gate.policy(name, (ctx) => {
            if (name.includes(":")) return ctx.auth.scopes.has(name);
            return Boolean(ctx.auth.verified);
          }),
        );
      }
    }
  }

  return decls;
}

function declFromManifestGate(name: string, def: ManifestGate): GateDecl {
  if (def.kind === "rate" || name.startsWith("rate:")) {
    const parsed = name.startsWith("rate:")
      ? parseRateName(name)
      : {
          strategy: def.strategy ?? "sliding-window-counter",
          max: def.max ?? 1,
          per: def.per ?? "1m",
        };
    return {
      kind: "rate",
      name,
      strategy: (def.strategy ?? parsed.strategy) as RateGateDecl["strategy"],
      max: def.max ?? parsed.max,
      per: def.per ?? parsed.per,
      keyBy: def.keyBy,
      overridable: Boolean(
        (def as ManifestGate & { overridable?: boolean }).overridable,
      ),
    };
  }

  const scopes = def.scopes ?? [];
  return gate.policy(name, (ctx) => {
    if (scopes.length > 0) {
      return scopes.every((s) => ctx.auth.scopes.has(s));
    }
    if (name.includes(":")) return ctx.auth.scopes.has(name);
    return Boolean(ctx.auth.verified);
  });
}

/** Parse `rate:{strategy}:{max}/{per}`. */
function parseRateName(name: string): {
  strategy: RateGateDecl["strategy"];
  max: number;
  per: string;
} {
  // rate:sliding-window-counter:300/1m
  const rest = name.slice("rate:".length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) {
    return { strategy: "sliding-window-counter", max: 1, per: "1m" };
  }
  const strategy = rest.slice(0, lastColon) as RateGateDecl["strategy"];
  const [maxStr, per = "1m"] = rest.slice(lastColon + 1).split("/");
  return {
    strategy: strategy || "sliding-window-counter",
    max: Number(maxStr) || 1,
    per,
  };
}
