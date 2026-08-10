/**
 * console.traces.replay — real re-invoke via {@link runReplay} (oke replay).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WideEvent } from "../../runs/types.ts";
import { startConsoleApp } from "./serve.ts";

function sampleEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    id: "req-replay-1",
    flow: "notes.create",
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    error: null,
    input: { title: "hello" },
    effects: [],
    logs: [],
    durationMs: 12,
    startedAt: 1,
    endedAt: 13,
    dimensions: {},
    ...overrides,
  };
}

describe("console.traces.replay", () => {
  test("POST /console/traces/replay re-invokes through runReplay (not a no-op)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-replay-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-traces-replay",
      silentClaim: true,
    });

    try {
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
      const { data: session } = (await claimRes.json()) as {
        data: { accessToken: string };
      };

      const event = sampleEvent();
      const runs = handle.app.bootResult?.runs;
      expect(runs).toBeDefined();
      await runs!.append(event);

      let seen: { readonly event: WideEvent; readonly dryRun: boolean } | null = null;
      handle.state.replayTrace = async ({ event: ev, dryRun }) => {
        seen = { event: ev, dryRun };
        return { output: { ok: true, title: (ev.input as { title: string }).title } };
      };

      const res = await handle.app.fetch(
        new Request("http://console.test/console/traces/replay", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({ rootId: event.id, dryRun: false }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { ok: true; rootId: string; dryRun: boolean; flow: string };
        error: null;
      };
      expect(body.error).toBeNull();
      expect(body.data.ok).toBe(true);
      expect(body.data.rootId).toBe(event.id);
      expect(body.data.flow).toBe("notes.create");
      expect(body.data.dryRun).toBe(false);

      expect(seen).not.toBeNull();
      expect(seen!.event.id).toBe(event.id);
      expect(seen!.event.input).toEqual({ title: "hello" });
      expect(seen!.dryRun).toBe(false);
    } finally {
      await handle.app.stop();
    }
  });

  test("forces dry-run when the ledger has send/ask", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-replay-dry-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-traces-replay-dry",
      silentClaim: true,
    });

    try {
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
      const { data: session } = (await claimRes.json()) as {
        data: { accessToken: string };
      };

      const event = sampleEvent({
        id: "req-send",
        effects: [
          {
            kind: "send",
            resource: "mail",
            timestamp: 1,
            duration: 2,
            reversibility: "irreversible",
          },
        ],
      });
      await handle.app.bootResult!.runs!.append(event);

      let dry: boolean | undefined;
      handle.state.replayTrace = async ({ dryRun }) => {
        dry = dryRun;
        return { output: { ok: true } };
      };

      const res = await handle.app.fetch(
        new Request("http://console.test/console/traces/replay", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({ rootId: event.id, dryRun: false }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { dryRun: boolean } };
      expect(body.data.dryRun).toBe(true);
      expect(dry).toBe(true);
    } finally {
      await handle.app.stop();
    }
  });

  test("rejects runs with no stored input", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-replay-noinput-"));
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-traces-replay-noinput",
      silentClaim: true,
    });

    try {
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
      const { data: session } = (await claimRes.json()) as {
        data: { accessToken: string };
      };

      const event = sampleEvent({ id: "req-no-input", input: undefined });
      await handle.app.bootResult!.runs!.append(event);

      const res = await handle.app.fetch(
        new Request("http://console.test/console/traces/replay", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({ rootId: event.id, dryRun: true }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; data?: { reason?: string } };
      };
      expect(body.error.code).toBe("ReplayUnavailable");
      expect(body.error.data?.reason).toBe("no_stored_input");
    } finally {
      await handle.app.stop();
    }
  });
});
