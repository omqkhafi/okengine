/**
 * Seeded host app for Console ui-next invoke-as (Playwright + vite seeded).
 *
 * Real `bookings.create` execution — not stub echo / `inv_*`.
 */

import { z } from "zod";
import { gate } from "../../elements/gate.ts";
import { oke, type OkeApp } from "../../kernel/app.ts";
import { flow, resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
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
import { bindHostInvokeUserFlow, type ConsoleInvokeUserFlow } from "../server/invoke-user-flow.ts";

const memoryDrivers = {
  store: { kv: { dev: "memory", test: "memory", prod: "memory" } },
  signal: { dev: "memory", test: "memory", prod: "memory" },
  clock: { dev: "memory", test: "frozen", prod: "memory" },
  journal: { dev: "memory", test: "memory", prod: "memory" },
  channel: { email: { dev: "console", test: "console", prod: "console" } },
  vault: { dev: "memory", test: "memory", prod: "memory" },
} as const;

const member = gate.policy("member", ({ auth }) => !!auth.verified);
const bookingCreate = gate.policy("booking:create", ({ auth }) =>
  auth.scopes.has("booking:create"),
);
const bookingsWrite = gate.policy("bookings.write", ({ auth }) =>
  auth.scopes.has("booking:create"),
);

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

/**
 * Boot a host app + bind {@link ConsoleInvokeUserFlow} for seeded Console.
 */
export async function bootUiNextSeedInvoke(): Promise<{
  readonly app: OkeApp;
  readonly invokeUserFlow: ConsoleInvokeUserFlow;
  readonly stop: () => Promise<void>;
}> {
  // Console seed Manifest may have drained vault decls into process registries.
  clearElementRegistries();
  resetBindings();
  resetFlowSeq();

  on(
    http.post("/bookings").gate(member).gate(bookingCreate).gate(bookingsWrite),
    flow("bookings.create", {
      in: z.object({
        flightId: z.string(),
        seats: z.number().int().min(1),
        cabin: z.enum(["economy", "business"]).optional(),
      }),
      out: z.object({
        id: z.string(),
        userId: z.string(),
      }),
      do: (input, fx) => ({
        id: `real_${input.flightId}_${input.seats}`,
        userId: fx.auth.userId ?? "missing",
      }),
    }),
  );

  const app = oke({
    name: "ui-next-seed-invoke",
    gate: { policies: [member, bookingCreate, bookingsWrite] },
    env: "test",
    config: { drivers: memoryDrivers },
    vault: { allowDevFallbacks: true },
    startScheduler: false,
  });
  await app.boot({
    env: "test",
    gates: [member, bookingCreate, bookingsWrite],
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
