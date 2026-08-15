import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { userPrincipal } from "../auth/planes.ts";
import type { ConsoleState } from "../console/server/state.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { attachHostToConsole } from "./attach-host-console.ts";

const OKE = resolve(import.meta.dir, "../index.ts");

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("attachHostToConsole", () => {
  test("wires invoke-as and the host store onto Console state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-attach-"));
    const entry = join(dir, "app.ts");
    await writeFile(
      entry,
      `
import { oke, on, flow, http, gate, store } from ${JSON.stringify(OKE)};
const db = store.sql("db");
export const ping = on(
  http.get("/ping").gate.public,
  flow("main.ping", { do: () => ({ ok: true }) }),
);
export const app = oke({
  name: "attach-host",
  stores: [db],
  gate: { policies: [gate.public] },
}).adopt({ ping });
`,
    );

    const state = { invokeUserFlow: null, storeRuntime: null } as unknown as ConsoleState;
    const ingested: Array<{ event?: { flow?: string } }> = [];
    const attached = await attachHostToConsole({
      entry,
      cwd: dir,
      state,
      runsBridge: {
        url: "http://console.test/console/runs/ingest",
        secret: "test-ingest",
        fetch: async (_url, init) => {
          ingested.push(JSON.parse(String(init?.body ?? "{}")) as { event?: { flow?: string } });
          return new Response(null, { status: 204 });
        },
      },
    });
    expect(attached).not.toBeNull();
    expect(state.invokeUserFlow).toBeTypeOf("function");
    expect(state.storeRuntime).toBeTruthy();

    const result = await state.invokeUserFlow!({
      flowId: "main.ping",
      body: {},
      principal: userPrincipal({ userId: "u1", verified: true }),
      operatorId: "op",
    });
    expect(result.status).toBe(200);
    expect(result.output).toEqual({ ok: true });
    expect(ingested.some((row) => row.event?.flow === "main.ping")).toBe(true);
    await attached!.stop();
    expect(state.invokeUserFlow).toBeNull();
  });

  test("returns null when the entry is not a bootable app", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-attach-empty-"));
    const entry = join(dir, "app.ts");
    await writeFile(entry, "export {}\n");
    const state = { invokeUserFlow: null, storeRuntime: null } as unknown as ConsoleState;
    const attached = await attachHostToConsole({ entry, cwd: dir, state });
    expect(attached).toBeNull();
    expect(state.invokeUserFlow).toBeNull();
  });
});
