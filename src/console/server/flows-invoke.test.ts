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
import { field, store } from "../../elements/store.ts";
import { PII_MASK } from "../../elements/store/classify.ts";
import { createTestApp } from "../../test/create-test-app.ts";
import type { Manifest } from "../../manifest/types.ts";
import { FLOWS_TEST_MANIFEST } from "../ui-next/src/features/flows/fixture.ts";
import { bindHostInvokeUserFlow } from "./invoke-user-flow.ts";
import { startConsoleApp } from "./serve.ts";
import { setManifest } from "./state.ts";
import type { InvokeUserFlowInput } from "./invoke-user-flow.ts";

/** Fixture plus the booking gate the host actually enforces. */
const BOOKING_INVOKE_MANIFEST: Manifest = {
  ...FLOWS_TEST_MANIFEST,
  gates: {
    member: { kind: "policy", scopes: ["member"] },
    "booking:create": { kind: "policy", scopes: ["booking:create"] },
  },
  flows: {
    ...FLOWS_TEST_MANIFEST.flows,
    "bookings.create": {
      ...FLOWS_TEST_MANIFEST.flows!["bookings.create"]!,
      gates: ["member", "booking:create"],
    },
  },
};

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
      const body = (await invokeRes.json()) as {
        error: { code: string; data?: { reason?: string } };
      };
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
      manifest: BOOKING_INVOKE_MANIFEST,
    });
    const host = await bootInvokeHost();
    try {
      setManifest(handle.state, BOOKING_INVOKE_MANIFEST);
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
          durationMs?: number;
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
      expect(invokeBody.data.durationMs).toBeGreaterThan(0);
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
      manifest: BOOKING_INVOKE_MANIFEST,
    });
    const host = await bootInvokeHost();
    const seen: InvokeUserFlowInput[] = [];
    try {
      setManifest(handle.state, BOOKING_INVOKE_MANIFEST);
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

  test("Operator bypasses gates; public is denied on member flows", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-gate-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows-gate",
      silentClaim: true,
      production: false,
      manifest: FLOWS_TEST_MANIFEST,
    });
    const host = await bootInvokeHost();
    try {
      setManifest(handle.state, FLOWS_TEST_MANIFEST);
      handle.state.invokeUserFlow = bindHostInvokeUserFlow(host);
      const auth = await claimOperator(handle);

      const asOperator = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "OP1", seats: 1 },
          }),
        }),
      );
      expect(asOperator.status).toBe(200);
      const operatorBody = (await asOperator.json()) as {
        data: { asUserId: string; asGate: string | null; response: { id: string } };
      };
      expect(operatorBody.data.asUserId).toBe("console:operator");
      expect(operatorBody.data.asGate).toBeNull();
      expect(operatorBody.data.response.id).toBe("real_OP1_1");

      const asPublic = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.create",
            body: { flightId: "PUB1", seats: 1 },
            asGate: "public",
          }),
        }),
      );
      expect(asPublic.status).toBe(200);
      const publicBody = (await asPublic.json()) as {
        data: { failure?: { code: string }; status?: number };
      };
      expect(publicBody.data.failure?.code).toBe("Unauthorized");
      expect(publicBody.data.status).toBe(401);
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

  test("masks classified PII on invoke unless revealPii", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-pii-"));
    const manifest = {
      ...FLOWS_TEST_MANIFEST,
      stores: {
        db: {
          facet: "sql" as const,
          tables: {
            bookings: {
              columns: { email: { pii: true } },
            },
          },
        },
      },
    };
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows-pii",
      silentClaim: true,
      production: false,
      manifest,
    });
    try {
      setManifest(handle.state, manifest);
      handle.state.invokeUserFlow = async () => ({
        output: { id: "b1", email: "leak@oke.com" },
        status: 200,
      });
      const auth = await claimOperator(handle);

      const maskedRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.mine",
            body: {},
            asUserId: "user_demo",
          }),
        }),
      );
      expect(maskedRes.status).toBe(200);
      const maskedBody = (await maskedRes.json()) as {
        data: { response: { id: string; email: string }; masked: boolean };
      };
      expect(maskedBody.data.masked).toBe(true);
      expect(maskedBody.data.response.id).toBe("b1");
      expect(maskedBody.data.response.email).toBe(PII_MASK);

      const revealedRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            flowId: "bookings.mine",
            body: {},
            asUserId: "user_demo",
            revealPii: true,
          }),
        }),
      );
      expect(revealedRes.status).toBe(200);
      const revealedBody = (await revealedRes.json()) as {
        data: { response: { id: string; email: string }; masked: boolean };
      };
      expect(revealedBody.data.masked).toBe(false);
      expect(revealedBody.data.response.email).toBe("leak@oke.com");
    } finally {
      await handle.app.stop();
    }
  });

  test("revealPii unmasks store-classified columns the handler reads", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-store-pii-"));
    const views = store.schema.table("views", {
      id: field.text().primaryKey(),
      name: field.text().notNull(),
      ownerEmail: field.text().pii(),
    });
    const db = store.sql("db", { schema: { views } });
    resetBindings();
    resetFlowSeq();
    on(
      http.post("/views").gate(member),
      flow("views.seed", {
        in: z.object({
          id: z.string(),
          name: z.string(),
          ownerEmail: z.string(),
        }),
        out: z.object({ id: z.string() }),
        do: async (input, fx) => {
          await fx.store(db).insert(views).values(input);
          return { id: input.id };
        },
      }),
    );
    on(
      http.get("/views").gate(member),
      flow("views.list", {
        in: z.object({}),
        out: z.object({
          items: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              ownerEmail: z.string().nullable(),
            }),
          ),
        }),
        do: async (_input, fx) => {
          const items = await fx.store(db).select().from(views);
          return {
            items: items.map((row) => ({
              id: String(row.id),
              name: String(row.name),
              ownerEmail: typeof row.ownerEmail === "string" ? row.ownerEmail : null,
            })),
          };
        },
      }),
    );
    const host = oke({
      name: "invoke-store-pii-host",
      gate: { policies: [member] },
      env: "test",
      stores: [db],
      config: { drivers: { store: { sql: { test: "pglite" } } } },
      startScheduler: false,
    });
    const harness = await createTestApp(host);
    const seedFlow = host.bindings.find((b) => b.flow.name === "views.seed")?.flow;
    expect(seedFlow).toBeDefined();
    const seeded = await host.execute(
      seedFlow!,
      { id: "view_web_board", name: "Web board", ownerEmail: "aria@keel.dev" },
      { kind: "internal" },
      { trustedInvoke: true, bypassGates: true },
    );
    expect(seeded.failure).toBeUndefined();

    const manifest = {
      ...FLOWS_TEST_MANIFEST,
      flows: {
        ...FLOWS_TEST_MANIFEST.flows,
        "views.list": {
          trigger: { http: { method: "GET" as const, path: "/views" } },
          effects: { reads: ["sql:db" as const] },
          source: "src/flows/views/index.ts:1",
        },
      },
      stores: {
        db: {
          facet: "sql" as const,
          tables: {
            views: {
              columns: { ownerEmail: { pii: true } },
            },
          },
        },
      },
    };
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows-store-pii",
      silentClaim: true,
      production: false,
      manifest,
    });
    try {
      setManifest(handle.state, manifest);
      handle.state.invokeUserFlow = bindHostInvokeUserFlow(host);
      const auth = await claimOperator(handle);

      const maskedRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ flowId: "views.list", body: {} }),
        }),
      );
      expect(maskedRes.status).toBe(200);
      const maskedBody = (await maskedRes.json()) as {
        data: { response: { items: Array<{ ownerEmail: string }> }; masked: boolean };
      };
      expect(maskedBody.data.masked).toBe(true);
      expect(maskedBody.data.response.items[0]?.ownerEmail).toBe(PII_MASK);

      const revealedRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ flowId: "views.list", body: {}, revealPii: true }),
        }),
      );
      expect(revealedRes.status).toBe(200);
      const revealedBody = (await revealedRes.json()) as {
        data: { response: { items: Array<{ ownerEmail: string }> }; masked: boolean };
      };
      expect(revealedBody.data.masked).toBe(false);
      expect(revealedBody.data.response.items[0]?.ownerEmail).toBe("aria@keel.dev");
    } finally {
      await harness.close();
      await handle.app.stop();
    }
  });

  test("invoke envelope reports host cache without inventing a hit", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-flows-cache-"));
    const notes = store.schema.table("notes", {
      id: field.text().primaryKey(),
      title: field.text().notNull(),
    });
    const db = store.sql("app", { schema: { notes } });
    resetBindings();
    resetFlowSeq();
    on(
      http.get("/notes").gate(member),
      flow("notes.list", {
        in: z.object({}),
        out: z.array(z.object({ id: z.string(), title: z.string() })),
        effects: { reads: ["sql:notes"] },
        do: () => [{ id: "n1", title: "Harbor" }],
      }),
    );
    const host = oke({
      name: "invoke-cache-host",
      gate: { policies: [member] },
      env: "test",
      stores: [db],
      config: { drivers: { store: { sql: { test: "pglite" } } } },
      startScheduler: false,
    });
    const harness = await createTestApp(host);
    const manifest = {
      ...FLOWS_TEST_MANIFEST,
      flows: {
        ...FLOWS_TEST_MANIFEST.flows,
        "notes.list": {
          trigger: { http: { method: "GET" as const, path: "/notes" } },
          effects: { reads: ["sql:notes" as const] },
          source: "src/flows/notes/index.ts:1",
        },
      },
    };
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-flows-cache",
      silentClaim: true,
      production: false,
      manifest,
    });
    try {
      setManifest(handle.state, manifest);
      handle.state.invokeUserFlow = bindHostInvokeUserFlow(host);
      const auth = await claimOperator(handle);

      const firstRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ flowId: "notes.list", body: {} }),
        }),
      );
      expect(firstRes.status).toBe(200);
      const firstBody = (await firstRes.json()) as {
        data: { cache?: "hit" | "miss" | "none" };
      };
      expect(firstBody.data.cache).not.toBe("hit");

      const secondRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ flowId: "notes.list", body: {} }),
        }),
      );
      expect(secondRes.status).toBe(200);
      const secondBody = (await secondRes.json()) as {
        data: { cache?: "hit" | "miss" | "none" };
      };
      expect(secondBody.data.cache).toBe("hit");

      const revealedRes = await handle.app.fetch(
        new Request("http://console.test/console/flows/invoke", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ flowId: "notes.list", body: {}, revealPii: true }),
        }),
      );
      expect(revealedRes.status).toBe(200);
      const revealedBody = (await revealedRes.json()) as {
        data: { cache?: "hit" | "miss" | "none" };
      };
      expect(revealedBody.data.cache).not.toBe("hit");
    } finally {
      await harness.close();
      await handle.app.stop();
    }
  });
});
