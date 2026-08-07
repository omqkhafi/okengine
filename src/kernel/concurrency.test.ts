import { describe, expect, test } from "bun:test";

import { currentAbortSignal, isAbortError, withAbortSignal } from "./abort-scope.ts";
import { createMemoryJournalStore } from "./journal.ts";
import { createFx, createFxContext } from "./fx.ts";
import { flow } from "./flow.ts";
import { runDurable } from "../elements/clock/durable.ts";
import { fxAll, fxRace } from "./concurrency.ts";

describe("fx.all — structured concurrency", () => {
  test("resolves tuple results in order", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    const out = await fx.all([async () => 1, async () => "a", () => true]);
    expect(out).toEqual([1, "a", true]);
  });

  test("on failure aborts sibling branches via ambient signal", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    let siblingAborted = false;
    let loserSawAbort = false;

    await expect(
      fx.all([
        async () => {
          await new Promise<void>((_resolve, reject) => {
            const signal = fx.signal;
            if (signal.aborted) {
              loserSawAbort = true;
              reject(signal.reason ?? new Error("aborted"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                siblingAborted = true;
                loserSawAbort = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
            // Stay pending until aborted.
          });
        },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("boom");
        },
      ]),
    ).rejects.toThrow("boom");

    expect(siblingAborted || loserSawAbort).toBe(true);
  });

  test("empty all resolves to []", async () => {
    await expect(fxAll([])).resolves.toEqual([]);
  });
});

describe("fx.race — structured concurrency", () => {
  test("winner wins and loser sees abort", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    let loserAborted = false;

    const value = await fx.race([
      async () => {
        await new Promise<void>((_resolve, reject) => {
          fx.signal.addEventListener(
            "abort",
            () => {
              loserAborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
        return "slow";
      },
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "fast";
      },
    ]);

    expect(value).toBe("fast");
    // Give the abort listener a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(loserAborted).toBe(true);
  });

  test("empty race throws", async () => {
    await expect(fxRace([])).rejects.toThrow(/empty/);
  });
});

describe("fx.using — scoped cleanup", () => {
  test("release runs on success and on thrown error", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    const released: string[] = [];

    const ok = await fx.using(
      async () => "res-a",
      (r) => {
        released.push(`ok:${r}`);
      },
      async (r) => r.toUpperCase(),
    );
    expect(ok).toBe("RES-A");
    expect(released).toEqual(["ok:res-a"]);

    await expect(
      fx.using(
        async () => "res-b",
        async (r) => {
          released.push(`err:${r}`);
        },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    expect(released).toEqual(["ok:res-a", "err:res-b"]);
  });

  test("release runs when a sibling fx.race winner aborts mid-use", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    let released = false;

    const winner = await fx.race([
      () =>
        fx.using(
          async () => "lock",
          () => {
            released = true;
          },
          () =>
            new Promise<never>(() => {
              // Stay pending until ambient abort releases us.
            }),
        ),
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "fast";
      },
    ]);

    expect(winner).toBe("fast");
    // Let the abort listener settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(released).toBe(true);
  });
});

describe("fx.retry", () => {
  test("retries then succeeds", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    let n = 0;
    const value = await fx.retry(
      async () => {
        n += 1;
        if (n < 3) throw new Error("transient");
        return "ok";
      },
      { retries: 3, delay: 0, jitter: false },
    );
    expect(value).toBe("ok");
    expect(n).toBe(3);
  });

  test("does not retry AbortError", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    let n = 0;
    await expect(
      fx.retry(
        async () => {
          n += 1;
          throw new DOMException("aborted", "AbortError");
        },
        { retries: 3, delay: 0 },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(n).toBe(1);
  });

  test("honors when predicate", async () => {
    const fx = createFx({ flow: "t", effects: {} });
    let n = 0;
    await expect(
      fx.retry(
        async () => {
          n += 1;
          throw new Error("nope");
        },
        { retries: 5, delay: 0, when: () => false },
      ),
    ).rejects.toThrow("nope");
    expect(n).toBe(1);
  });
});

describe("ambient abort signal", () => {
  test("outside scope is never aborted", () => {
    const fx = createFx({ flow: "t", effects: {} });
    expect(fx.signal.aborted).toBe(false);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
  });

  test("withAbortSignal installs ambient signal", async () => {
    const ctrl = new AbortController();
    await withAbortSignal(ctrl.signal, async () => {
      expect(currentAbortSignal()).toBe(ctrl.signal);
    });
  });
});

describe("retry + durable journal", () => {
  test("fx.retry inside fx.step does not re-run completed step on resume", async () => {
    const journalStore = createMemoryJournalStore();
    let attempts = 0;
    let crash = true;

    const f = flow("pay.retry", {
      durable: true,
      do: async (_input, fx) => {
        const charged = await fx.step("charge", () =>
          fx.retry(
            async () => {
              attempts += 1;
              return { id: "ch_1" };
            },
            { retries: 2, delay: 0 },
          ),
        );
        if (crash) throw new Error("KILLED");
        return charged;
      },
    });

    const first = await runDurable({ flow: f, journalStore });
    expect(first.status).toBe("failed");
    expect(attempts).toBe(1);

    crash = false;
    const second = await runDurable({
      flow: f,
      journalStore,
      runId: first.status === "failed" ? first.runId : "",
    });
    expect(second.status).toBe("completed");
    expect(attempts).toBe(1);
  });

  test("flow(name, { retry }) reuses journal — completed steps do not re-run", async () => {
    const journalStore = createMemoryJournalStore();
    const calls: string[] = [];
    let failOnce = true;

    const f = flow("flow.retry", {
      durable: true,
      retry: { retries: 2, delay: 0, jitter: false },
      do: async (_input, fx) => {
        await fx.step("a", () => {
          calls.push("a");
          return 1;
        });
        if (failOnce) {
          failOnce = false;
          throw new Error("transient");
        }
        return fx.step("b", () => {
          calls.push("b");
          return 2;
        });
      },
    });

    const result = await runDurable({ flow: f, journalStore });
    expect(result.status).toBe("completed");
    // step a ran once; flow-level retry re-entered do but journal replayed a.
    expect(calls).toEqual(["a", "b"]);
  });
});

describe("capability + concurrency compose", () => {
  test("fx.all records effects from successful branches", async () => {
    const { fx, ledger } = createFxContext({
      flow: "parallel",
      effects: { emits: ["a", "b"] },
    });
    await fx.all([() => fx.emit("a"), () => fx.emit("b")]);
    expect(ledger.entries.map((e) => e.resource)).toEqual(["a", "b"]);
  });
});
