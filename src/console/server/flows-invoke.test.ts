/**
 * Console flows invoke-as — real host execution (not stub).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { gate } from "../../elements/gate.ts";
import { oke } from "../../kernel/app.ts";
import { flow, resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { FLOWS_TEST_MANIFEST } from "../ui/flows/fixture.ts";
import { bindHostInvokeUserFlow } from "./invoke-user-flow.ts";
import { startConsoleApp } from "./serve.ts";
import { setManifest } from "./state.ts";
import type { InvokeUserFlowInput } from "./invoke-user-flow.ts";

const memoryDrivers = {
  store: { kv: { dev: "memory", test: "memory", prod: "memory" } },
  signal: { dev: "memory", test: "memory", prod: "memory" },
  clock: { dev: "memory", test: "frozen", prod: "memory" },
  journal: { dev: "memory", test: "memory", prod: "memory" },
  channel: { email: { dev: "console", test: "console", prod: "console" } },
} as const;

const member = gate.policy("member", ({ auth }) => !!auth.verified);
const bookingCreate = gate.policy("booking:create", ({ auth }) =>
  auth.scopes.has("booking:create"),
);

async function claimOperator(handle: Awaited<ReturnType<typeof startConsoleApp>>) {
  const claimRes = await handle.app.fetch(
    new Request("http://console.test/console/setup/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claimCode: handle.state.claim.code,
        email: "ops@example.com",
        name: "Ops",
        password: "Password1234!",
      }),
    }),
  );
  expect(claimRes.status).toBe(200);
  const claimBody = (await claimRes.json()) as { data: { accessToken: string } };
  return {
    authorization: `Bearer ${claimBody.data.accessToken}`,
    "content-type": "application/json",
  };
}

async function bootInvokeHost() {
  resetBindings();
  resetFlowSeq();

  on(
    http.post("/bookings").gate(member).gate(bookingCreate),
    flow("bookings.create", {
      in: z.object({
        flightId: z.string(),
        seats: z.number().int().min(1),
      }),
      out: z.object({
        id: z.string(),
        userId: z.string(),
        scopes: z.array(z.string()),
      }),
      do: (input, fx) => ({
        id: `real_${input.flightId}_${input.seats}`,
        userId: fx.auth.userId ?? "missing",
        scopes: [...fx.auth.scopes].sort(),
      }),
    }),
  );

  on(
    http.get("/notes/:id").gate(member),
    flow("notes.get", {
      in: z.object({ id: z.string() }),
      out: z.object({ id: z.string(), title: z.string() }),
      do: (input) => ({ id: input.id, title: `note-${input.id}` }),
    }),
  );

  const app = oke({
    name: "invoke-host",
    gate: { policies: [member, bookingCreate] },
    env: "dev",
    config: { drivers: memoryDrivers },
    startScheduler: false,
  });
  await app.boot({
    env: "dev",
    gates: [member, bookingCreate],
    startScheduler: false,
    config: app.$options.config,
  });
  return app;
}

describe("console flows invoke", () => {
  test("fails closed when host invoke is not configured", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-unbound-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows",
      silentClaim: true,
      production: false,
      manifest: FLOWS_TEST_MANIFEST,
    });
    try {
      setManifest(handle.state, FLOWS_TEST_MANIFEST);
      const auth = await claimOperator(handle);

      const invokeRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "SK1", seats: 2 },
            asUserId: "user_demo",
          }),
        }),
      );
      expect(invokeRes.status).toBe(400);
      const body = (await invokeRes.json()) as { error: { code: string; data?: { reason?: string } } };
      expect(body.error.code).toBe("InvokeDenied");
      expect(body.error.data?.reason).toBe("host invoke not configured");
    } finally {
      await handle.app.stop();
    }
  });

  test("lists identities and invokes for real via host adapter (not stub)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-real-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows",
      silentClaim: true,
      production: false,
      manifest: FLOWS_TEST_MANIFEST,
    });
    const host = await bootInvokeHost();
    try {
      setManifest(handle.state, FLOWS_TEST_MANIFEST);
      handle.state.invokeUserFlow = bindHostInvokeUserFlow(host);
      const auth = await claimOperator(handle);

      const idsRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/identities", {
          headers: auth,
        }),
      );
      expect(idsRes.status).toBe(200);
      const idsBody = (await idsRes.json()) as {
        data: { identities: Array<{ id: string }> };
      };
      expect(idsBody.data.identities.length).toBeGreaterThan(0);
      const asUserId = idsBody.data.identities[0]!.id;

      const invokeRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "SK1", seats: 2 },
            asUserId,
          }),
        }),
      );
      expect(invokeRes.status).toBe(200);
      const invokeBody = (await invokeRes.json()) as {
        data: {
          ok: true;
          response: { id: string; userId: string; scopes: string[] };
          status?: number;
          failure?: unknown;
          peakTier: string;
        };
        error: null;
      };
      expect(invokeBody.error).toBeNull();
      expect(invokeBody.data.ok).toBe(true);
      expect(invokeBody.data.status).toBe(200);
      expect(invokeBody.data.failure).toBeUndefined();
      // Real handler output — not stub `inv_*` / `echo`.
      expect(invokeBody.data.response.id).toBe("real_SK1_2");
      expect(invokeBody.data.response.id).not.toMatch(/^inv_/);
      expect(invokeBody.data.response).not.toHaveProperty("echo");
      expect(invokeBody.data.response.userId).toBe(asUserId);
      expect(invokeBody.data.peakTier).toBe("emits");
    } finally {
      await host.stop();
      await handle.app.stop();
    }
  });

  test("adversarial: asUserId A never executes with identity B scopes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-adv-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows-adv",
      silentClaim: true,
      production: false,
      manifest: FLOWS_TEST_MANIFEST,
    });
    const host = await bootInvokeHost();
    const seen: InvokeUserFlowInput[] = [];
    try {
      setManifest(handle.state, FLOWS_TEST_MANIFEST);
      const bound = bindHostInvokeUserFlow(host);
      handle.state.invokeUserFlow = async (input) => {
        seen.push(input);
        return bound(input);
      };
      const auth = await claimOperator(handle);

      const demo = handle.state.identities.find((i) => i.id === "user_demo")!;
      const memberId = handle.state.identities.find((i) => i.id === "user_member")!;
      expect(demo.scopes).toContain("booking:create");
      expect(memberId.scopes).not.toContain("booking:create");

      const asDemo = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "A1", seats: 1 },
            asUserId: "user_demo",
          }),
        }),
      );
      expect(asDemo.status).toBe(200);
      const demoBody = (await asDemo.json()) as {
        data: { response: { userId: string; scopes: string[] }; status?: number };
      };
      expect(demoBody.data.response.userId).toBe("user_demo");
      expect(demoBody.data.response.scopes).toEqual([...demo.scopes].sort());
      expect(demoBody.data.response.scopes).not.toEqual([...memberId.scopes].sort());

      const asMember = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "B1", seats: 1 },
            asUserId: "user_member",
          }),
        }),
      );
      expect(asMember.status).toBe(200);
      const memberBody = (await asMember.json()) as {
        data: {
          response: unknown;
          status?: number;
          failure?: { code: string };
        };
      };
      // Member lacks booking:create — host gate denies; must not run as demo.
      expect(memberBody.data.failure?.code).toBe("Forbidden");
      expect(memberBody.data.status).toBe(403);
      expect(memberBody.data.response).toBeNull();

      expect(seen).toHaveLength(2);
      expect(seen[0]!.principal.userId).toBe("user_demo");
      expect([...seen[0]!.principal.scopes].sort()).toEqual([...demo.scopes].sort());
      expect(seen[1]!.principal.userId).toBe("user_member");
      expect([...seen[1]!.principal.scopes].sort()).toEqual([...memberId.scopes].sort());
      expect(seen[1]!.principal.scopes.has("booking:create")).toBe(false);
    } finally {
      await host.stop();
      await handle.app.stop();
    }
  });

  test("pathParams merge into host handler input", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-params-"));
    const manifest = {
      ...FLOWS_TEST_MANIFEST,
      flows: {
        ...FLOWS_TEST_MANIFEST.flows,
        "notes.get": {
          trigger: { http: { method: "GET" as const, path: "/notes/:id" } },
          in: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
          out: {
            type: "object",
            required: ["id", "title"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
          },
          effects: { reads: ["sql:notes" as const] },
          plane: "user" as const,
        },
      },
    };
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows-params",
      silentClaim: true,
      production: false,
      manifest,
    });
    const host = await bootInvokeHost();
    try {
      setManifest(handle.state, manifest);
      handle.state.invokeUserFlow = bindHostInvokeUserFlow(host);
      const auth = await claimOperator(handle);

      const invokeRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "notes.get",
            body: {},
            pathParams: { id: "n-42" },
            asUserId: "user_member",
          }),
        }),
      );
      expect(invokeRes.status).toBe(200);
      const body = (await invokeRes.json()) as {
        data: { response: { id: string; title: string }; status?: number };
      };
      expect(body.data.status).toBe(200);
      expect(body.data.response).toEqual({ id: "n-42", title: "note-n-42" });
    } finally {
      await host.stop();
      await handle.app.stop();
    }
  });

  test("production irreversible invoke requires typed confirmation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-prod-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows",
      silentClaim: true,
      production: true,
      manifest: FLOWS_TEST_MANIFEST,
    });
    const host = await bootInvokeHost();
    try {
      handle.state.invokeUserFlow = bindHostInvokeUserFlow(host);
      const auth = await claimOperator(handle);

      const denied = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "fulfillment.onOrder",
            body: {},
            asUserId: "user_demo",
          }),
        }),
      );
      expect(denied.status).toBe(400);
      const deniedBody = (await denied.json()) as { error: { code: string } };
      expect(deniedBody.error.code).toBe("ConfirmRequired");

      // Confirm passes the gate; host may then 404 the signal-only flow name.
      const ok = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "fulfillment.onOrder",
            body: {},
            asUserId: "user_demo",
            confirmation: "INVOKE",
            reason: "incident dry-run",
          }),
        }),
      );
      expect(ok.status).toBe(200);
      const okBody = (await ok.json()) as {
        data: { failure?: { code: string }; status?: number };
        error: null;
      };
      expect(okBody.error).toBeNull();
      expect(okBody.data.failure?.code).toBe("NotFound");
    } finally {
      await host.stop();
      await handle.app.stop();
    }
  });
});
