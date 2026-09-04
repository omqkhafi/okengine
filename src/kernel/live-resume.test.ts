/**
 * HTTP Last-Event-ID resume and 410 LiveResumeGap before SSE.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { signal, resetSignals } from "../elements/signal/declare.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { stampFlowName } from "./stamp-http.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
  resetSignals();
});

describe("live Last-Event-ID resume", () => {
  afterEach(() => {
    resetBindings();
    resetFlowSeq();
    resetSignals();
  });

  test("skips through Last-Event-ID and 410s a pruned cursor", async () => {
    const orderStatus = signal.live("order-status", { optional: true });
    const feed = on(http.get("/feed").public().live(orderStatus));
    stampFlowName(feed, "orders.feed");
    on(
      http.post("/emit").public(),
      flow("orders.emit", {
        do: async (_input, fx) => {
          await fx.emit(orderStatus, { status: "placed" });
          await fx.emit(orderStatus, { status: "shipped" });
        },
      }),
    );

    const app = oke({ name: "live-resume" });
    const emitted = await app.fetch(new Request("http://localhost/emit", { method: "POST" }));
    expect(emitted.status).toBe(204);

    const firstCtrl = new AbortController();
    const first = await app.fetch(
      new Request("http://localhost/feed", { signal: firstCtrl.signal }),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toMatch(/text\/event-stream/);
    const firstFrames = await readSseFrames(first, 2);
    firstCtrl.abort();
    expect(firstFrames.map((f) => f.data)).toEqual([{ status: "placed" }, { status: "shipped" }]);
    const cursor = firstFrames[0]!.id;
    expect(cursor).toBeTruthy();

    const resumeCtrl = new AbortController();
    const resume = await app.fetch(
      new Request("http://localhost/feed", {
        signal: resumeCtrl.signal,
        headers: { "last-event-id": cursor! },
      }),
    );
    expect(resume.status).toBe(200);
    const rest = await readSseFrames(resume, 1);
    resumeCtrl.abort();
    expect(rest.map((f) => f.data)).toEqual([{ status: "shipped" }]);

    const gap = await app.fetch(
      new Request("http://localhost/feed", {
        headers: { "last-event-id": "never-existed" },
      }),
    );
    expect(gap.status).toBe(410);
    expect(gap.headers.get("content-type")).toMatch(/application\/json/);
    expect(await gap.json()).toMatchObject({
      data: null,
      error: {
        code: "LiveResumeGap",
        data: { signal: "order-status", afterId: "never-existed" },
      },
    });
  });
});

async function readSseFrames(
  res: Response,
  n: number,
): Promise<Array<{ id?: string; data: unknown }>> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  const out: Array<{ id?: string; data: unknown }> = [];
  try {
    while (out.length < n) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep = buf.indexOf("\n\n");
      while (sep >= 0 && out.length < n) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const frame = parseFrame(raw);
        if (frame) out.push(frame);
        sep = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  return out;
}

function parseFrame(raw: string): { id?: string; data: unknown } | undefined {
  const dataLines: string[] = [];
  let id: string | undefined;
  for (const line of raw.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).replace(/^ /, "");
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return undefined;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return undefined;
  return { ...(id !== undefined ? { id } : {}), data: JSON.parse(data) as unknown };
}
