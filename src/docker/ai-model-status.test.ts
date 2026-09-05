import { describe, expect, test } from "bun:test";
import {
  aiModelIdsMatch,
  formatAiModelStatusMessage,
  normalizeAiProbeUrl,
  probeAiModelStatus,
  startAiModelWatch,
  statusFromOpenAiModels,
} from "./ai-model-status.ts";

describe("ai-model-status", () => {
  test("normalizeAiProbeUrl keeps a single /v1 for openai-compatible", () => {
    expect(normalizeAiProbeUrl("http://127.0.0.1:8080", "openai-compatible")).toBe(
      "http://127.0.0.1:8080/v1",
    );
    expect(normalizeAiProbeUrl("http://127.0.0.1:8080/v1/", "openai-compatible")).toBe(
      "http://127.0.0.1:8080/v1",
    );
  });

  test("aiModelIdsMatch tolerates quant aliasing", () => {
    expect(aiModelIdsMatch("gemma4:e4b-q4_K_M", "gemma4:Q4_K_M")).toBe(true);
    expect(aiModelIdsMatch("smollm2", "smollm2")).toBe(true);
    expect(aiModelIdsMatch("gemma4:e4b-q4_K_M", "qwen3:8b")).toBe(false);
  });

  test("statusFromOpenAiModels maps loading → ready", () => {
    const loading = statusFromOpenAiModels("gemma4:e4b-q4_K_M", {
      data: [{ id: "gemma4:Q4_K_M", status: { value: "loading" } }],
    });
    expect(loading.phase).toBe("loading");
    expect(loading.reportedId).toBe("gemma4:Q4_K_M");

    const ready = statusFromOpenAiModels("smollm2", {
      data: [{ id: "smollm2", status: { value: "ready" } }],
    });
    expect(ready.phase).toBe("ready");
  });

  test("statusFromOpenAiModels treats empty list as starting", () => {
    expect(statusFromOpenAiModels("smollm2", { data: [] }).phase).toBe("starting");
  });

  test("probeAiModelStatus uses injectable fetch", async () => {
    const status = await probeAiModelStatus({
      url: "http://127.0.0.1:9/v1",
      model: "smollm2",
      kind: "openai-compatible",
      fetch: async () =>
        new Response(JSON.stringify({ data: [{ id: "smollm2", status: { value: "ready" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(status.phase).toBe("ready");
    expect(formatAiModelStatusMessage(status)).toBe("AI smollm2 — ready");
  });

  test("startAiModelWatch stops on ready and cancels cleanly", async () => {
    const messages: string[] = [];
    let calls = 0;
    const phases: string[] = [];
    const stop = startAiModelWatch({
      url: "http://127.0.0.1:9/v1",
      model: "smollm2",
      kind: "openai-compatible",
      intervalMs: 1,
      timeoutMs: 5_000,
      onStatus: (m, status) => {
        messages.push(m);
        phases.push(status.phase);
      },
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        const phase = calls < 2 ? "loading" : "ready";
        return new Response(
          JSON.stringify({ data: [{ id: "smollm2", status: { value: phase } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    await Bun.sleep(20);
    expect(messages).toContain("AI smollm2 — loading…");
    expect(messages).toContain("AI smollm2 — ready");
    expect(phases).toContain("loading");
    expect(phases).toContain("ready");
    stop();
  });
});
