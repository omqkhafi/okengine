/**
 * Host → Console WideEvent ingest (oke dev live Traces bridge).
 *
 * Accepts POSTed events from the host child, appends into Console's own
 * RunsRuntime (which is already wrapped by {@link wrapConsoleRunsForLive}),
 * and never returns event payloads — operators only see masked rows via
 * `GET /console/runs` / `/console/live`.
 */

import { z } from "zod";
import { RUNS_INGEST_SECRET_HEADER } from "../../runs/bridge-to-console.ts";
import type { WideEvent } from "../../runs/types.ts";
import type { ConsoleAppHandle } from "./app.ts";
import { constantTimeEqual } from "./claim.ts";

/** Ingest path under the Console HTTP surface. */
export const RUNS_INGEST_PATH = "/console/runs/ingest";

const WideEventIngestSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().optional(),
    flow: z.string().min(1),
    unit: z.string().optional(),
    trigger: z.string().min(1),
    plane: z.enum(["user", "operator"]),
    tenant: z.string().nullable().optional(),
    principal: z.string().nullable().optional(),
    subjectId: z.string().nullable().optional(),
    gates: z.array(z.string()),
    cache: z.enum(["hit", "miss", "none"]),
    replica: z.enum(["primary", "replica"]).optional(),
    replicaLagMs: z.number().optional(),
    cost: z.number().optional(),
    promptVersion: z.number().optional(),
    buildVersion: z.string().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string().optional(),
      })
      .nullable()
      .optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    effects: z.array(z.unknown()),
    logs: z.array(z.unknown()),
    durationMs: z.number(),
    startedAt: z.number(),
    endedAt: z.number(),
    archived: z.record(z.string(), z.string()).optional(),
    dimensions: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const IngestBodySchema = z.object({
  event: WideEventIngestSchema,
});

/**
 * Append one host WideEvent into the Console runs store.
 *
 * @param handle - Booted Console app
 * @param event - Validated wide event
 */
export async function appendHostRunToConsole(
  handle: ConsoleAppHandle,
  event: WideEvent,
): Promise<void> {
  const runs = handle.app.bootResult?.runs;
  if (!runs) {
    throw new Error("console runs ingest: Console runs runtime is not open");
  }
  await runs.append(event);
}

/**
 * Handle `POST /console/runs/ingest` — secret-gated, no event echo.
 *
 * @param request - Incoming request
 * @param handle - Booted Console app
 */
export async function handleRunsIngest(
  request: Request,
  handle: ConsoleAppHandle,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  const expected = handle.state.runsIngestSecret;
  if (expected === null || expected.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  const provided = request.headers.get(RUNS_INGEST_SECRET_HEADER) ?? "";
  if (!constantTimeEqual(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const parsed = IngestBodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Bad Request", { status: 400 });
  }

  const event = parsed.data.event as unknown as WideEvent;
  try {
    await appendHostRunToConsole(handle, event);
  } catch {
    return new Response("Service Unavailable", { status: 503 });
  }

  // Never echo the WideEvent — operators read masked projections only.
  return new Response(null, { status: 204 });
}
