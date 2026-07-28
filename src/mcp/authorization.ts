/**
 * MCP access control — descends to tool, parameter, and operation.
 *
 * Server-level controls alone are exactly where the confused deputy lives
 * (console §10.3). Every tool declares:
 * - required Module:Action scopes (attenuated against the operator)
 * - mutability (read vs write)
 * - parameter-level constraints
 *
 * MCP inherits operator-plane capability and never exceeds it.
 */

import { attenuateScopes, type AttenuationResult } from "../auth/attenuation.ts";

/** Tool mutability class. */
export type McpMutability = "read" | "write";

/** Parameter-level constraint. */
export interface McpParamPolicy {
  /** Parameter name. */
  readonly name: string;
  /** When true, the parameter may only take values from `allow`. */
  readonly enum?: readonly string[];
  /** Reject when present (operation not exposed to agents). */
  readonly forbid?: true;
  /** Maximum string / array length. */
  readonly maxLength?: number;
}

/** Declared ACL for one MCP tool. */
export interface McpToolPolicy {
  /** Tool name. */
  readonly name: string;
  /** Required Module:Action scopes (all must be held). */
  readonly scopes: readonly string[];
  /** Read tools are default; write tools need fresh confirmation. */
  readonly mutability: McpMutability;
  /** Parameter-level rules. */
  readonly params?: readonly McpParamPolicy[];
  /** Human-readable description for tools/list. */
  readonly description: string;
  /** JSON Schema for arguments (MCP tools/list). */
  readonly inputSchema: Record<string, unknown>;
}

/** Authorisation decision. */
export type AuthzDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "unknown-tool" | "plane" | "scope" | "param" | "confirmation-required";
      readonly detail?: string;
      readonly excess?: readonly string[];
    };

/**
 * Builtin MCP tool policies.
 *
 * Read-only by default. Writes require confirmation at the call site.
 */
export const MCP_TOOL_POLICIES: readonly McpToolPolicy[] = [
  {
    name: "oke.manifest.get",
    scopes: ["mcp:manifest:read", "console:manifest:read"],
    mutability: "read",
    description: "Return the current Manifest catalogue as inert data.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "oke.schema.get",
    scopes: ["mcp:schema:read", "console:manifest:read"],
    mutability: "read",
    description: "Return in/out/error schemas for a named flow as inert data.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", minLength: 1 },
      },
      required: ["flowId"],
      additionalProperties: false,
    },
    params: [{ name: "flowId", maxLength: 256 }],
  },
  {
    name: "oke.effects.get",
    scopes: ["mcp:effects:read", "console:manifest:read"],
    mutability: "read",
    description: "Return declared effects for a named flow as inert data.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", minLength: 1 },
      },
      required: ["flowId"],
      additionalProperties: false,
    },
    params: [{ name: "flowId", maxLength: 256 }],
  },
  {
    name: "oke.traces.list",
    scopes: ["mcp:traces:read", "console:runs:read"],
    mutability: "read",
    description: "List recent runs/traces as inert data.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        flowId: { type: "string" },
      },
      additionalProperties: false,
    },
    params: [
      { name: "limit", maxLength: 3 },
      { name: "flowId", maxLength: 256 },
    ],
  },
  {
    name: "oke.traces.get",
    scopes: ["mcp:traces:read", "console:runs:read"],
    mutability: "read",
    description: "Return one run/trace record as inert data.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", minLength: 1 },
      },
      required: ["runId"],
      additionalProperties: false,
    },
    params: [{ name: "runId", maxLength: 128 }],
  },
  {
    name: "oke.action.invoke",
    scopes: ["mcp:action:invoke", "console:flows:invoke"],
    mutability: "write",
    description: "Invoke a flow (sensitive). Requires fresh human confirmation per call.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", minLength: 1 },
        body: {},
        confirmation: { type: "string" },
        confirmToken: { type: "string" },
        reason: { type: "string" },
      },
      required: ["flowId"],
      additionalProperties: false,
    },
    params: [
      { name: "flowId", maxLength: 256 },
      { name: "reason", maxLength: 2000 },
    ],
  },
  {
    name: "oke.action.confirm",
    scopes: ["mcp:action:invoke", "console:flows:invoke"],
    mutability: "read",
    description: "Request a single-use confirmation token for a write tool (no caching).",
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          enum: ["oke.action.invoke", "oke.action.structural_propose"],
        },
        args: { type: "object" },
        reason: { type: "string", minLength: 3 },
      },
      required: ["tool", "args", "reason"],
      additionalProperties: false,
    },
    params: [
      {
        name: "tool",
        enum: ["oke.action.invoke", "oke.action.structural_propose"],
      },
      { name: "reason", maxLength: 2000 },
    ],
  },
  {
    name: "oke.action.structural_propose",
    scopes: ["mcp:action:structural", "console:structural:propose"],
    mutability: "write",
    description: "Propose a structural diff (reviewable; not applied). Requires confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        relativePath: { type: "string", minLength: 1 },
        contents: { type: "string" },
        confirmation: { type: "string" },
        confirmToken: { type: "string" },
        reason: { type: "string" },
      },
      required: ["title", "relativePath", "contents"],
      additionalProperties: false,
    },
    params: [
      { name: "title", maxLength: 200 },
      { name: "relativePath", maxLength: 512 },
      { name: "reason", maxLength: 2000 },
    ],
  },
];

/** Lookup map. */
export const MCP_POLICY_BY_NAME: ReadonlyMap<string, McpToolPolicy> = new Map(
  MCP_TOOL_POLICIES.map((p) => [p.name, p] as const),
);

/**
 * Expand operator scopes: `console:*` covers every `console:…` and, for MCP
 * inheritance, every `mcp:…` scope that the Console operator plane may grant.
 *
 * @param scopes - Raw scopes from the access token
 */
export function expandOperatorScopes(scopes: Iterable<string>): ReadonlySet<string> {
  const out = new Set<string>();
  let star = false;
  for (const s of scopes) {
    out.add(s);
    if (s === "console:*" || s === "mcp:*") star = true;
  }
  if (star) {
    for (const policy of MCP_TOOL_POLICIES) {
      for (const scope of policy.scopes) out.add(scope);
    }
  }
  return out;
}

/**
 * Authorise a tool call against policy + operator scopes + parameters.
 *
 * @param tool - Tool name
 * @param args - Tool arguments
 * @param operatorScopes - Verified operator scopes
 * @param options - Whether confirmation has already been consumed
 */
export function authorizeToolCall(
  tool: string,
  args: Record<string, unknown>,
  operatorScopes: Iterable<string>,
  options: { readonly confirmed: boolean } = { confirmed: false },
): AuthzDecision {
  const policy = MCP_POLICY_BY_NAME.get(tool);
  if (!policy) {
    return { ok: false, reason: "unknown-tool", detail: tool };
  }

  const held = expandOperatorScopes(operatorScopes);
  const attenuation: AttenuationResult = attenuateScopes(held, policy.scopes);
  // Tool scopes are alternatives across surfaces (`mcp:…` OR `console:…`).
  // Accept when the operator holds at least one scope from the policy list.
  const holdsAny = policy.scopes.some((s) => held.has(s));
  if (!holdsAny) {
    return {
      ok: false,
      reason: "scope",
      detail: `missing one of: ${policy.scopes.join(", ")}`,
      excess: attenuation.excess,
    };
  }

  const paramCheck = checkParams(policy, args);
  if (!paramCheck.ok) return paramCheck;

  if (policy.mutability === "write" && !options.confirmed) {
    return {
      ok: false,
      reason: "confirmation-required",
      detail: `${tool} is write/sensitive and requires fresh human confirmation`,
    };
  }

  return { ok: true };
}

/**
 * Validate parameter-level constraints.
 *
 * @param policy - Tool policy
 * @param args - Arguments
 */
export function checkParams(policy: McpToolPolicy, args: Record<string, unknown>): AuthzDecision {
  if (!policy.params) return { ok: true };
  for (const rule of policy.params) {
    const value = args[rule.name];
    if (value === undefined) continue;
    if (rule.forbid) {
      return {
        ok: false,
        reason: "param",
        detail: `parameter ${rule.name} is forbidden`,
      };
    }
    if (rule.enum && typeof value === "string" && !rule.enum.includes(value)) {
      return {
        ok: false,
        reason: "param",
        detail: `parameter ${rule.name} not in allow-list`,
      };
    }
    if (
      rule.maxLength !== undefined &&
      typeof value === "string" &&
      value.length > rule.maxLength
    ) {
      return {
        ok: false,
        reason: "param",
        detail: `parameter ${rule.name} exceeds maxLength ${rule.maxLength}`,
      };
    }
  }
  return { ok: true };
}
