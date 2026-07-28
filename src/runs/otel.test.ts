/**
 * OTel OTLP/HTTP JSON export — required span fields + additive wrap.
 */

import { describe, expect, test } from "bun:test";
import {
  createOtelStore,
  withOtelExport,
  type OtelExportOptions,
} from "./drivers/otel.ts";
import { memoryRunsDriver } from "./drivers/memory.ts";
import {
  msToUnixNano,
  toOtelId,
  wideEventToOtlpExportRequest,
  wideEventToOtlpSpan,
  type OtlpExportTracesServiceRequest,
} from "./otel-map.ts";
import { createRunsRuntime } from "./runtime.ts";
import type { WideEvent } from "./types.ts";

function sampleEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  const startedAt = 1_700_000_000_000;
  return {
    id: "run-abc",
    parentId: "run-parent",
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: "t1",
    principal: "u1",
    gates: ["member"],
    cache: "miss",
    effects: [
      {
        kind: "write",
        resource: "sql:bookings",
        timestamp: startedAt,
        duration: 2,
        reversibility: "reversible",
      },
    ],
    logs: [],
    durationMs: 12,
    startedAt,
    endedAt: startedAt + 12,
    error: null,
    dimensions: { flow: "bookings.create" },
    ...overrides,
  };
}

describe("wideEventToOtlpSpan — OTel required fields", () => {
  test("emits traceId, spanId, name, start/end unix nano", () => {
    const event = sampleEvent();
    const span = wideEventToOtlpSpan(event);

    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.name).toBe("bookings.create");
    expect(span.kind).toBe(2); // SPAN_KIND_SERVER
    expect(span.startTimeUnixNano).toBe(msToUnixNano(event.startedAt));
    expect(span.endTimeUnixNano).toBe(msToUnixNano(event.endedAt));
    expect(span.status.code).toBe(1); // OK
    expect(span.attributes.some((a) => a.key === "oke.flow")).toBe(true);
  });

  test("error runs set STATUS_CODE_ERROR", () => {
    const span = wideEventToOtlpSpan(
      sampleEvent({
        error: { code: "Unauthorized", message: "nope" },
      }),
    );
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe("nope");
  });

  test("toOtelId lengths are stable", () => {
    expect(toOtelId("x", 16)).toHaveLength(16);
    expect(toOtelId("x", 32)).toHaveLength(32);
  });
});

describe("OTLP export request envelope", () => {
  test("resourceSpans → scopeSpans → spans", () => {
    const req = wideEventToOtlpExportRequest(sampleEvent(), {
      serviceName: "skyport",
    });
    expect(req.resourceSpans).toHaveLength(1);
    const resource = req.resourceSpans[0]!;
    expect(
      resource.resource.attributes.find((a) => a.key === "service.name")
        ?.value,
    ).toEqual({ stringValue: "skyport" });
    expect(resource.scopeSpans[0]!.spans).toHaveLength(1);
    expect(resource.scopeSpans[0]!.spans[0]!.name).toBe("bookings.create");
  });
});

describe("withOtelExport — additive", () => {
  test("primary store still holds the event; OTLP body is posted", async () => {
    const posted: OtlpExportTracesServiceRequest[] = [];
    const otel: OtelExportOptions = {
      endpoint: "http://127.0.0.1:4318/v1/traces",
      serviceName: "test-app",
      transport: async (_url, body) => {
        posted.push(body);
      },
    };

    const runs = createRunsRuntime({
      driver: withOtelExport(memoryRunsDriver, otel),
    });
    await runs.open();
    const event = sampleEvent({ id: "run-1", parentId: undefined });
    await runs.append(event);

    const all = await runs.all();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("run-1");

    expect(posted).toHaveLength(1);
    const span = posted[0]!.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.name).toBe("bookings.create");
    expect(span.traceId).toHaveLength(32);
    expect(span.spanId).toHaveLength(16);
    expect(span.startTimeUnixNano).toBeTruthy();
    expect(span.endTimeUnixNano).toBeTruthy();

    await runs.close();
  });

  test("createRunsRuntime({ otel }) wires the exporter", async () => {
    const posted: OtlpExportTracesServiceRequest[] = [];
    const runs = createRunsRuntime({
      driver: "memory",
      otel: {
        endpoint: "http://collector/v1/traces",
        transport: async (_url, body) => {
          posted.push(body);
        },
      },
    });
    await runs.open();
    await runs.append(sampleEvent({ id: "r2", parentId: undefined }));
    expect(posted).toHaveLength(1);
    expect(await runs.all()).toHaveLength(1);
    await runs.close();
  });

  test("createOtelStore exports without local retention", async () => {
    const posted: OtlpExportTracesServiceRequest[] = [];
    const store = createOtelStore({
      endpoint: "http://collector/v1/traces",
      transport: async (_url, body) => {
        posted.push(body);
      },
    });
    await store.append(sampleEvent({ id: "solo", parentId: undefined }));
    expect(posted).toHaveLength(1);
    expect(await store.all()).toEqual([]);
    await store.close();
  });
});
