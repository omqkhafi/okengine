/**
 * Seeded host app for Console ui-next invoke-as (Playwright + vite seeded).
 *
 * HTTP flows execute against the Console Store runtime so Call API returns
 * the row that moved (list items, created id, deleted object) — not a stub
 * `{ ok, flow, userId }` echo.
 */

import { z } from "zod";
import { gate } from "../../elements/gate.ts";
import type { StoreRuntime } from "../../elements/store.ts";
import { oke, type OkeApp } from "../../kernel/app.ts";
import { flow, resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http, type HttpMethod, type HttpTrigger } from "../../kernel/triggers.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  aiAgentRegistry,
  aiEmbedRegistry,
  aiModelRegistry,
  aiPromptRegistry,
  channelTemplateRegistry,
  requiredEnvRegistry,
  secretRegistry,
  signalRegistry,
  storeRegistry,
} from "../../kernel/element-registries.ts";
import { createManifestStoreRuntime } from "../server/store.ts";
import { bindHostInvokeUserFlow, type ConsoleInvokeUserFlow } from "../server/invoke-user-flow.ts";
import { executeSeedInvoke } from "./seed-invoke-ops.ts";
import { UI_NEXT_SEEDED_MANIFEST } from "./ui-next-seed-manifest.ts";
import { seedUiNextStoreData } from "./ui-next-seed-store.ts";

const memoryDrivers = {
  store: { kv: { dev: "memory", test: "memory", prod: "memory" } },
  signal: { dev: "memory", test: "memory", prod: "memory" },
  clock: { dev: "memory", test: "frozen", prod: "memory" },
  journal: { dev: "memory", test: "memory", prod: "memory" },
  channel: { email: { dev: "console", test: "console", prod: "console" } },
  vault: { dev: "memory", test: "memory", prod: "memory" },
} as const;

const HTTP_VERBS: Record<HttpMethod, (path: string) => HttpTrigger> = {
  GET: (path) => http.get(path),
  POST: (path) => http.post(path),
  PUT: (path) => http.put(path),
  PATCH: (path) => http.patch(path),
  DELETE: (path) => http.delete(path),
  OPTIONS: (path) => http.options(path),
  HEAD: (path) => http.head(path),
  QUERY: (path) => http.query(path),
};

const member = gate.policy("member", ({ auth }) => !!auth.verified);
const issueWrite = gate.policy("issue:write", ({ auth }) => auth.scopes.has("issue:write"));
const issuesWrite = gate.policy("issues.write", ({ auth }) => auth.scopes.has("issue:write"));

const SCOPE_GATES = [
  "project:admin",
  "triage:accept",
  "team:admin",
  "comment:write",
  "files:write",
  "member:admin",
  "webhook:admin",
  "comments.write",
  "labels.write",
] as const;

const extraPolicies = SCOPE_GATES.map((name) =>
  gate.policy(name, ({ auth }) => !!auth.verified || auth.scopes.has(name)),
);

const gateByName: Record<string, typeof member> = {
  member,
  "issue:write": issueWrite,
  "issues.write": issuesWrite,
};
for (const g of extraPolicies) {
  gateByName[g.name] = g;
}

const allGates = [member, issueWrite, issuesWrite, ...extraPolicies];

function clearElementRegistries(): void {
  storeRegistry.length = 0;
  secretRegistry.length = 0;
  requiredEnvRegistry.length = 0;
  signalRegistry.length = 0;
  channelTemplateRegistry.length = 0;
  aiModelRegistry.length = 0;
  aiPromptRegistry.length = 0;
  aiEmbedRegistry.length = 0;
  aiAgentRegistry.length = 0;
}

const SeedIn = z.record(z.string(), z.unknown()).optional();
const SeedOut = z.record(z.string(), z.unknown());
const NotFoundData = z.object({
  id: z.string(),
  flow: z.string(),
});

/** Options for {@link bootUiNextSeedInvoke}. */
export interface BootUiNextSeedInvokeOptions {
  /** Shared Console Store — when omitted, a private seeded runtime is created. */
  readonly storeRuntime?: StoreRuntime;
  /** Manifest used to classify flows (defaults to the keel seed). */
  readonly manifest?: Manifest;
}

/**
 * Bind every Manifest HTTP flow to {@link executeSeedInvoke}.
 *
 * @param runtime - Store runtime (shared with Console Store when provided)
 * @param manifest - Seed Manifest
 */
function bindSeedHttpSurface(runtime: StoreRuntime, manifest: Manifest): void {
  for (const [id, flowDecl] of Object.entries(manifest.flows ?? {})) {
    const spec = flowDecl.trigger?.http;
    if (!spec) continue;
    const verb = HTTP_VERBS[spec.method];
    const named = (flowDecl.gates ?? []).map((name) => gateByName[name] ?? member);
    const trigger = verb(spec.path).gate(...(named.length > 0 ? named : [member]));
    const path = spec.path;
    on(
      trigger,
      flow(id, {
        in: SeedIn,
        out: SeedOut,
        errors: { NotFound: NotFoundData },
        do: async (input, fx) => {
          const assembled =
            input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
          return executeSeedInvoke({
            runtime,
            manifest,
            flowId: id,
            path,
            decl: flowDecl,
            input: assembled,
            userId: fx.auth.userId ?? "missing",
          });
        },
      }),
    );
  }
}

/**
 * Boot a host app + bind {@link ConsoleInvokeUserFlow} for seeded Console.
 *
 * @param options - Optional shared Store runtime
 */
export async function bootUiNextSeedInvoke(options: BootUiNextSeedInvokeOptions = {}): Promise<{
  readonly app: OkeApp;
  readonly invokeUserFlow: ConsoleInvokeUserFlow;
  readonly stop: () => Promise<void>;
}> {
  // Console seed Manifest may have drained vault decls into process registries.
  clearElementRegistries();
  resetBindings();
  resetFlowSeq();

  const manifest = options.manifest ?? UI_NEXT_SEEDED_MANIFEST;
  const runtime = options.storeRuntime ?? (await createOwnedSeedRuntime(manifest));

  bindSeedHttpSurface(runtime, manifest);

  const app = oke({
    name: "ui-next-seed-invoke",
    gate: { policies: allGates },
    env: "test",
    config: { drivers: memoryDrivers },
    vault: { allowDevFallbacks: true },
    startScheduler: false,
  });
  await app.boot({
    env: "test",
    gates: allGates,
    startScheduler: false,
    config: app.$options.config,
    vault: { allowDevFallbacks: true },
  });

  return {
    app,
    invokeUserFlow: bindHostInvokeUserFlow(app),
    stop: async () => {
      await app.stop();
    },
  };
}

async function createOwnedSeedRuntime(manifest: Manifest): Promise<StoreRuntime> {
  const runtime = await createManifestStoreRuntime(manifest);
  await seedUiNextStoreData(runtime);
  return runtime;
}
