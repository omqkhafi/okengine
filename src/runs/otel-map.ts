/**
 * Map a {@link WideEvent} to an OTLP/HTTP JSON ExportTracesServiceRequest.
 *
 * Field mapping follows the OpenTelemetry Trace proto JSON encoding
 * (opentelemetry/proto/trace/v1 + collector/trace/v1). Required span fields
 * per the OTel span data model: traceId, spanId, name, start/end timestamps.
 */

import type { WideEvent } from "./types.ts";

/** OTLP AnyValue (JSON encoding). */
export type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string | number }
  | { boolValue: boolean }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } };

/** OTLP KeyValue. */
export interface OtlpKeyValue {
  readonly key: string;
  readonly value: OtlpAnyValue;
}

/** OTLP Status. */
export interface OtlpStatus {
  readonly code: number;
  readonly message?: string;
}

/**
 * OTLP Span (JSON). Required: traceId, spanId, name, startTimeUnixNano,
 * endTimeUnixNano. Optional parentSpanId, attributes, status, kind.
 */
export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpKeyValue[];
  readonly status: OtlpStatus;
}

/** ResourceSpans → ScopeSpans → Span envelope. */
export interface OtlpExportTracesServiceRequest {
  readonly resourceSpans: readonly {
    readonly resource: {
      readonly attributes: readonly OtlpKeyValue[];
    };
    readonly scopeSpans: readonly {
      readonly scope: { readonly name: string; readonly version: string };
      readonly spans: readonly OtlpSpan[];
    }[];
  }[];
}

/** Options for {@link wideEventToOtlpExportRequest}. */
export interface WideEventOtlpOptions {
  /** `service.name` resource attribute. */
  readonly serviceName?: string;
  /** Instrumentation scope name. */
  readonly scopeName?: string;
  /** Instrumentation scope version. */
  readonly scopeVersion?: string;
}

/** SPAN_KIND_SERVER */
const SPAN_KIND_SERVER = 2;
/** STATUS_CODE_OK */
const STATUS_OK = 1;
/** STATUS_CODE_ERROR */
const STATUS_ERROR = 2;

/**
 * Convert one wide event into an OTLP export request containing a single span.
 *
 * @param event - Wide event (= one span)
 * @param options - Service / scope labels
 */
export function wideEventToOtlpExportRequest(
  event: WideEvent,
  options: WideEventOtlpOptions = {},
): OtlpExportTracesServiceRequest {
  const span = wideEventToOtlpSpan(event);
  const serviceName = options.serviceName ?? "okengine";
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            kvString("service.name", serviceName),
            kvString("telemetry.sdk.name", "okengine"),
            kvString("telemetry.sdk.language", "typescript"),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: options.scopeName ?? "okengine.runs",
              version: options.scopeVersion ?? "1.0.0",
            },
            spans: [span],
          },
        ],
      },
    ],
  };
}

/**
 * Map a wide event to one OTLP span with required fields populated.
 *
 * @param event - Wide event
 */
export function wideEventToOtlpSpan(event: WideEvent): OtlpSpan {
  const spanId = toOtelId(event.id, 16);
  const traceId = toOtelId(event.parentId ?? event.id, 32);
  const parentSpanId = event.parentId
    ? toOtelId(event.parentId, 16)
    : undefined;

  const attributes: OtlpKeyValue[] = [
    kvString("oke.flow", event.flow),
    kvString("oke.trigger", event.trigger),
    kvString("oke.plane", event.plane),
    kvString("oke.cache", event.cache),
    kvInt("oke.duration_ms", event.durationMs),
  ];
  if (event.unit) attributes.push(kvString("oke.unit", event.unit));
  if (event.tenant != null) attributes.push(kvString("oke.tenant", String(event.tenant)));
  if (event.principal != null) {
    attributes.push(kvString("oke.principal", String(event.principal)));
  }
  if (event.gates.length > 0) {
    attributes.push(kvString("oke.gates", event.gates.join(",")));
  }
  if (event.effects.length > 0) {
    attributes.push(
      kvString(
        "oke.effects",
        event.effects.map((e) => `${e.kind}:${e.resource}`).join(","),
      ),
    );
  }
  if (event.cost != null) attributes.push(kvDouble("oke.cost", event.cost));
  if (event.buildVersion) {
    attributes.push(kvString("oke.build_version", event.buildVersion));
  }

  const status: OtlpStatus = event.error
    ? {
        code: STATUS_ERROR,
        message: event.error.message ?? event.error.code,
      }
    : { code: STATUS_OK };

  if (event.error) {
    attributes.push(kvString("oke.error.code", event.error.code));
    if (event.error.message) {
      attributes.push(kvString("exception.message", event.error.message));
    }
  }

  return {
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name: event.flow,
    kind: SPAN_KIND_SERVER,
    startTimeUnixNano: msToUnixNano(event.startedAt),
    endTimeUnixNano: msToUnixNano(event.endedAt),
    attributes,
    status,
  };
}

/**
 * Deterministic hex id of the required OTel length (16 or 32 hex chars).
 *
 * @param seed - Run / parent id
 * @param hexLen - 16 (span) or 32 (trace)
 */
export function toOtelId(seed: string, hexLen: 16 | 32): string {
  const digest = bunHashHex(seed);
  if (digest.length >= hexLen) return digest.slice(0, hexLen);
  return digest.padEnd(hexLen, "0");
}

/**
 * @param ms - Epoch milliseconds
 */
export function msToUnixNano(ms: number): string {
  // BigInt avoids float precision loss for nanosecond timestamps.
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

/**
 * @param seed - Input string
 */
function bunHashHex(seed: string): string {
  // Bun.hash returns a bigint; expand to 32 hex chars stably.
  const h1 = Bun.hash(seed).toString(16).padStart(16, "0");
  const h2 = Bun.hash(`oke:${seed}`).toString(16).padStart(16, "0");
  return (h1 + h2).slice(0, 32);
}

function kvString(key: string, value: string): OtlpKeyValue {
  return { key, value: { stringValue: value } };
}

function kvInt(key: string, value: number): OtlpKeyValue {
  return { key, value: { intValue: String(Math.trunc(value)) } };
}

function kvDouble(key: string, value: number): OtlpKeyValue {
  return { key, value: { doubleValue: value } };
}
