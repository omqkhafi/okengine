# Writing a driver

Drivers are the community contribution surface (unified-theory §29). An
element earns its place from irreducible physics; new infrastructure becomes a
**driver** on an existing element — never a ninth element.

This guide uses a **real, tested** example from this repository: the
ClickHouse driver for the **runs** store (wide events / Traces). The code
below matches `src/runs/drivers/clickhouse.ts` and
`src/runs/drivers/clickhouse.test.ts`.

## Pick the right contract

| Surface | Interface | Path |
|---|---|---|
| Runs (wide events) | `RunsDriver` / `RunsStore` | `src/runs/types.ts` |
| Store SQL / KV / files / index | `SqlDriver` / `KvDriver` / … | `src/drivers/types.ts` |
| Vault | `VaultDriver` | `src/drivers/vault-types.ts` |
| Signal | `SignalDriver` | `src/drivers/signal-types.ts` |

Name the driver after the **protocol** (`clickhouse`, `postgres`, `redis`,
`s3`) — not a vendor. Vendor images belong under `images` in `oke.config.ts`.

## Runs driver contract (exact types)

From `src/runs/types.ts`:

```typescript
export type RunsDriverId = "files" | "memory" | "postgres" | "clickhouse";

export interface RunsStore {
  readonly driverId: RunsDriverId;
  append(event: WideEvent): Promise<void>;
  flush(): Promise<void>;
  query(sql: string): Promise<RunsRow[]>;
  all(): Promise<WideEvent[]>;
  close(): Promise<void>;
}

export interface RunsDriver {
  readonly id: RunsDriverId;
  open(options?: RunsOpenOptions): Promise<RunsStore>;
}
```

Registration lives in `src/runs/runtime.ts` (`DRIVER_BY_ID`). Export from
`src/runs/index.ts` so apps can `import { clickhouseRunsDriver } from "okengine"`.

Config pin (examples already use this shape):

```typescript
// oke.config.ts
export default defineConfig({
  drivers: {
    runs: { local: "files", test: "memory", prod: "clickhouse" },
  },
});
```

## Worked example — ClickHouse runs driver

### 1. Minimal client seam

Keep a tiny protocol surface so tests inject a fake and production uses HTTP:

```typescript
export interface RunsClickHouseClient {
  insert(table: string, rows: readonly RunsRow[]): Promise<void>;
  query(sql: string): Promise<RunsRow[]>;
  exec?(sql: string): Promise<void>;
}
```

### 2. Fake for unit tests

`createRunsClickHouseFake()` stores wide events in memory. The default
`open()` path uses it when neither `client` nor `url` is provided — so
`bun test` never needs a live ClickHouse.

### 3. Real HTTP via `fetch` (no mandatory npm client)

When `options.url` is set, `createRunsClickHouseHttp(url)` talks to the
ClickHouse HTTP interface (`INSERT … FORMAT JSONEachRow`, queries with
`FORMAT JSON`). Auth is optional Basic. This matches the optional-peer /
zero-mandatory-dep pattern used elsewhere (compare dynamic `import()` for
`age-encryption` on vault peers).

### 4. Driver `open()`

```typescript
export const clickhouseRunsDriver: RunsDriver = {
  id: "clickhouse",
  async open(options: RunsOpenOptions = {}): Promise<RunsStore> {
    const table = options.name ?? "oke_runs";
    let client = options.client as RunsClickHouseClient | undefined;

    if (!client && options.url) {
      client = createRunsClickHouseHttp(options.url);
      await ensureClickHouseRunsTable(client, table);
    }
    if (!client) {
      client = createRunsClickHouseFake();
    }

    return {
      driverId: "clickhouse",
      async append(event) {
        await client!.insert(table, [
          {
            id: event.id,
            flow: event.flow,
            duration_ms: event.durationMs,
            payload: JSON.stringify(event),
          },
        ]);
      },
      async flush() {},
      query: (sql) => client!.query(sql),
      async all() { /* … */ },
      async close() {},
    };
  },
};
```

### 5. Tests that must pass

From `src/runs/drivers/clickhouse.test.ts`:

```bash
bun test src/runs/drivers/clickhouse.test.ts
```

Coverage:

- Fake append + `count()` query
- HTTP client issues insert/query with mocked `fetch`
- `open({ url })` selects the HTTP path

The optional-drivers suite in `src/runs/runs.test.ts` also opens
`driver: "clickhouse"` through `createRunsRuntime`.

## Checklist for a new driver PR

1. Implement the interface with TSDoc on exports.
2. Register in the runtime map; re-export from the package barrel.
3. Fake or injected client for tests; real protocol behind `url` / peer.
4. No vendor id; document `images` separately if Docker is involved.
5. `bun test` + `bun run gate` green.
6. Short note in `docs/changelog.md` when user-visible.

## Related: additive exporters

Not every observability sink is a storage tier. The OTel OTLP exporter
(`src/runs/drivers/otel.ts`) wraps a storage driver with
`withOtelExport(base, { endpoint })` so Console Runs stay on `files` /
`memory` while spans POST to a collector. Prefer that pattern when the
sink should not replace queryable storage.
