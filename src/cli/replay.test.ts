import { describe, expect, test } from "bun:test";
import { createRunsRuntime } from "../runs/runtime.ts";
import type { WideEvent } from "../runs/types.ts";
import { eventHasIrreversible, findRunById, runReplay } from "./replay.ts";

function sampleEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    id: "run-1",
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

describe("oke replay", () => {
  test("eventHasIrreversible detects send/ask", () => {
    expect(eventHasIrreversible(sampleEvent())).toBe(false);
    expect(
      eventHasIrreversible(
        sampleEvent({
          effects: [
            {
              kind: "send",
              resource: "welcome",
              timestamp: 1,
              duration: 1,
              reversibility: "irreversible",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("findRunById + runReplay re-invokes with stored input", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    const event = sampleEvent({ id: "req-42" });
    await runs.append(event);

    expect(await findRunById(runs, "req-42")).toEqual(event);

    const lines: string[] = [];
    let seenInput: unknown;
    const code = await runReplay({
      requestId: "req-42",
      runs,
      write: (t) => lines.push(t),
      executeReplay: async (_entry, e, dryRun) => {
        seenInput = e.input;
        expect(dryRun).toBe(false);
        return { output: { ok: true, title: (e.input as { title: string }).title } };
      },
    });
    expect(code).toBe(0);
    expect(seenInput).toEqual({ title: "hello" });
    expect(lines.some((l) => l.includes("notes.create"))).toBe(true);

    await runs.close();
  });

  test("defaults to dry-run when ledger has send", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    await runs.append(
      sampleEvent({
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
      }),
    );

    let dry: boolean | undefined;
    const code = await runReplay({
      requestId: "req-send",
      runs,
      write: () => {},
      executeReplay: async (_e, _ev, dryRun) => {
        dry = dryRun;
        return { output: { ok: true } };
      },
    });
    expect(code).toBe(0);
    expect(dry).toBe(true);
    await runs.close();
  });
});
