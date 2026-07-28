/**
 * Optional OpenTelemetry OTLP/HTTP JSON exporter for wide events.
 *
 * Additive — wrap a storage {@link RunsDriver} with {@link withOtelExport},
 * or pass `otel` on {@link import("../runtime.ts").createRunsRuntime}. Console
 * Runs/Traces keep using the primary store; this module only maps each
 * {@link WideEvent} to an OTLP span and POSTs it to a collector.
 *
 * No mandatory dependency: OTLP/HTTP JSON is posted with `fetch` (lighter
 * than pulling `@opentelemetry/*` SDKs). Dynamic import is unnecessary for
 * `fetch`; the exporter is tree-shaken when unused.
 */

import type {
  RunsDriver,
  RunsOpenOptions,
  RunsRow,
  RunsStore,
  WideEvent,
} from "../types.ts";
import {
  wideEventToOtlpExportRequest,
  type OtlpExportTracesServiceRequest,
} from "../otel-map.ts";

/** Options for the OTel OTLP exporter. */
export interface OtelExportOptions {
  /**
   * OTLP/HTTP traces endpoint, e.g. `http://127.0.0.1:4318/v1/traces`.
   */
  readonly endpoint: string;
  /** Service name attribute (`service.name`). Default: `okengine`. */
  readonly serviceName?: string;
  /** Extra HTTP headers (auth tokens, tenant keys). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Injected transport for tests — receives the JSON body that would be POSTed.
   */
  readonly transport?: OtelTransport;
}

/** Transport used to deliver an OTLP export request. */
export type OtelTransport = (
  endpoint: string,
  body: OtlpExportTracesServiceRequest,
  headers: Readonly<Record<string, string>>,
) => Promise<void>;

/**
 * Default `fetch`-based OTLP/HTTP JSON transport.
 *
 * @param endpoint - Collector URL
 * @param body - ExportTracesServiceRequest
 * @param headers - Extra headers
 */
export async function otlpHttpJsonTransport(
  endpoint: string,
  body: OtlpExportTracesServiceRequest,
  headers: Readonly<Record<string, string>>,
): Promise<void> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `otel otlp export failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }
}

/**
 * Wrap a storage driver so every append also exports an OTLP span.
 *
 * @param base - Primary runs driver (files / memory / postgres / clickhouse)
 * @param otel - OTLP export options
 */
export function withOtelExport(
  base: RunsDriver,
  otel: OtelExportOptions,
): RunsDriver {
  if (!otel.endpoint) {
    throw new Error(
      "otel export: set endpoint to an OTLP/HTTP traces URL (e.g. http://127.0.0.1:4318/v1/traces)",
    );
  }
  return {
    id: base.id,
    async open(options?: RunsOpenOptions): Promise<RunsStore> {
      const store = await base.open(options);
      const exporter = createOtelStore(otel);
      return {
        driverId: store.driverId,
        async append(event: WideEvent): Promise<void> {
          await store.append(event);
          await exporter.append(event);
        },
        flush: () => store.flush(),
        query: (sql) => store.query(sql),
        all: () => store.all(),
        async close(): Promise<void> {
          await exporter.close();
          await store.close();
        },
      };
    },
  };
}

/**
 * Create a store that only exports spans (no local retention).
 *
 * @param otel - Export options
 */
export function createOtelStore(otel: OtelExportOptions): RunsStore {
  const transport = otel.transport ?? otlpHttpJsonTransport;
  const serviceName = otel.serviceName ?? "okengine";
  const headers = otel.headers ?? {};

  return {
    // Not a storage tier — query/all stay empty. Prefer withOtelExport.
    driverId: "memory",
    async append(event: WideEvent): Promise<void> {
      const body = wideEventToOtlpExportRequest(event, { serviceName });
      await transport(otel.endpoint, body, headers);
    },
    async flush(): Promise<void> {
      /* each append is immediate */
    },
    async query(_sql: string): Promise<RunsRow[]> {
      return [];
    },
    async all(): Promise<WideEvent[]> {
      return [];
    },
    async close(): Promise<void> {
      /* no resources */
    },
  };
}
