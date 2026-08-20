import { describe, expect, test } from "bun:test";
import type { ExecuteResult } from "../../kernel/app.ts";
import { OkeError, OKE_ERRORS } from "../../kernel/errors.ts";
import { jsonResultBrand, type JsonResult } from "../../kernel/fx.ts";
import { invokeResultFromExecute, resolveInvokeAs } from "./invoke-user-flow.ts";
import type { ConsoleIdentity } from "./state.ts";
import type { Manifest } from "../../manifest/types.ts";

const IDENTITIES: readonly ConsoleIdentity[] = [
  {
    id: "user_demo",
    email: "demo@example.com",
    name: "Demo User",
    status: "active",
    scopes: ["member", "issue:write"],
  },
  {
    id: "user_off",
    email: "off@example.com",
    name: "Off",
    status: "disabled",
    scopes: ["member"],
  },
];

const MANIFEST = {
  oke: "1.0",
  app: "t",
  gates: {
    member: { kind: "policy", description: "Signed-in", scopes: ["member"] },
    "issue:write": { kind: "policy", scopes: ["issue:write"] },
    "rate:api": { kind: "rate", max: 10, per: "1m" },
  },
} as Manifest;

function execute(over: Partial<ExecuteResult>): ExecuteResult {
  return {
    output: undefined,
    failure: undefined,
    response: undefined,
    ctx: {} as ExecuteResult["ctx"],
    fx: {} as ExecuteResult["fx"],
    cache: "none",
    durationMs: 0,
    runId: "run_test",
    ...over,
  };
}

describe("invokeResultFromExecute", () => {
  test("keeps handler output", async () => {
    const result = await invokeResultFromExecute(
      execute({ output: { items: [{ id: "iss_1" }], count: 1 } }),
    );
    expect(result).toEqual({
      output: { items: [{ id: "iss_1" }], count: 1 },
      status: 200,
      cache: "none",
      durationMs: 0,
    });
  });

  test("unwraps fx.json carriers", async () => {
    const output = {
      [jsonResultBrand]: true,
      status: 200,
      value: { ok: true },
    } as JsonResult<{ ok: true }>;
    const result = await invokeResultFromExecute(execute({ output }));
    expect(result.output).toEqual({ ok: true });
  });

  test("reads HTTP envelope when output is missing", async () => {
    const result = await invokeResultFromExecute(
      execute({
        response: Response.json({ data: { items: [], count: 0 }, error: null }),
      }),
    );
    expect(result.output).toEqual({ items: [], count: 0 });
    expect(result.status).toBe(200);
  });

  test("projects host handler duration", async () => {
    const result = await invokeResultFromExecute(
      execute({ output: { ok: true }, durationMs: 0.37 }),
    );
    expect(result.durationMs).toBe(0.37);
  });

  test("projects host cache hit and does not invent one", async () => {
    const hit = await invokeResultFromExecute(execute({ output: { ok: true }, cache: "hit" }));
    expect(hit.cache).toBe("hit");
    const omitted = await invokeResultFromExecute({
      output: { ok: true },
      failure: undefined,
      response: undefined,
      ctx: {} as ExecuteResult["ctx"],
      fx: {} as ExecuteResult["fx"],
    } as ExecuteResult);
    expect(omitted.cache).toBeUndefined();
  });

  test("success with no body is null, not omitted", async () => {
    const result = await invokeResultFromExecute(execute({}));
    expect(result.output).toBeNull();
    expect(result.status).toBe(200);
  });

  test("thrown OkeError is a 500 failure, not a null 200", async () => {
    const thrown = new OkeError(OKE_ERRORS.UNDECLARED_SECRET, {
      flow: "issues.list",
      resource: "PUBLIC_APP_URL",
    });
    const result = await invokeResultFromExecute(
      execute({
        ctx: { error: thrown } as ExecuteResult["ctx"],
        response: Response.json(
          { data: null, error: { code: "InternalError", message: thrown.message } },
          { status: 500 },
        ),
      }),
    );
    expect(result.status).toBe(500);
    expect(result.output).toBeNull();
    expect(result.failure?.code).toBe("OKE1006");
    expect(result.failure?.message).toContain("PUBLIC_APP_URL");
  });

  test("HTTP error envelope is a failure, not data: null success", async () => {
    const result = await invokeResultFromExecute(
      execute({
        response: Response.json(
          { data: null, error: { code: "InternalError", message: "vault missing" } },
          { status: 500 },
        ),
      }),
    );
    expect(result.status).toBe(500);
    expect(result.output).toBeNull();
    expect(result.failure).toEqual({
      code: "InternalError",
      message: "vault missing",
    });
  });
});

describe("resolveInvokeAs", () => {
  test("omitted gate and user is Operator bypass", () => {
    const resolved = resolveInvokeAs({}, IDENTITIES, MANIFEST);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.bypassGates).toBe(true);
    expect(resolved.asUserId).toBe("console:operator");
    expect(resolved.asGate).toBeNull();
  });

  test("public is anonymous and not bypass", () => {
    const resolved = resolveInvokeAs({ asGate: "public" }, IDENTITIES, MANIFEST);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.bypassGates).toBe(false);
    expect(resolved.principal.verified).toBe(false);
    expect(resolved.principal.userId).toBe("");
    expect(resolved.asUserId).toBe("public");
  });

  test("as user uses identity scopes", () => {
    const resolved = resolveInvokeAs(
      { asUserId: "user_demo", asGate: "member" },
      IDENTITIES,
      MANIFEST,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.bypassGates).toBe(false);
    expect(resolved.asUserId).toBe("user_demo");
    expect([...resolved.principal.scopes].sort()).toEqual(["issue:write", "member"]);
  });

  test("as policy uses gate scopes", () => {
    const resolved = resolveInvokeAs({ asGate: "member" }, IDENTITIES, MANIFEST);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.asUserId).toBe("");
    expect(resolved.principal.userId).toBe("");
    expect(resolved.rls).toEqual({ gate: "member", userId: "", scopes: ["member"] });
    expect([...resolved.principal.scopes]).toEqual(["member"]);
    expect(resolved.principal.verified).toBe(true);
  });

  test("unknown or rate gate is denied", () => {
    expect(resolveInvokeAs({ asGate: "missing" }, IDENTITIES, MANIFEST)).toEqual({
      ok: false,
      reason: "unknown gate: missing",
    });
    expect(resolveInvokeAs({ asGate: "rate:api" }, IDENTITIES, MANIFEST)).toEqual({
      ok: false,
      reason: "unknown gate: rate:api",
    });
  });

  test("disabled identity is denied", () => {
    expect(resolveInvokeAs({ asUserId: "user_off" }, IDENTITIES, MANIFEST)).toEqual({
      ok: false,
      reason: "identity not found or disabled",
    });
  });
});
