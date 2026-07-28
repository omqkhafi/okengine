# Writing a driver

Drivers are the community contribution surface (unified-theory §29). An
element earns its place from irreducible physics; new infrastructure becomes a
**driver** on an existing element — never a ninth element.

This guide uses a **real, tested** example from this repository: the
ClickHouse driver for the **runs** store (wide events / Traces). The code
below matches `src/runs/drivers/clickhouse.ts` and the clickhouse case in
`src/runs/runs.test.ts`.

## Pick the right contract

| Surface                        | Interface                    | Path                          |
| ------------------------------ | ---------------------------- | ----------------------------- |
| Runs (wide events)             | `RunsDriver` / `RunsStore`   | `src/runs/types.ts`           |
| Store SQL / KV / files / index | `SqlDriver` / `KvDriver` / … | `src/drivers/types.ts`        |
| Vault                          | `VaultDriver`                | `src/drivers/vault-types.ts`  |
| Signal                         | `SignalDriver`               | `src/drivers/signal-types.ts` |

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
`src/runs/index.ts` so apps can import the driver from `okengine`.

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

Real implementation from `src/runs/drivers/clickhouse.ts`:

```typescript
import type { RunsDriver, RunsOpenOptions, RunsRow, RunsStore, WideEvent } from "../types.ts";

/** Minimal ClickHouse HTTP-like client. */
export interface RunsClickHouseClient {
  insert(table: string, rows: readonly RunsRow[]): Promise<void>;
  query(sql: string): Promise<RunsRow[]>;
}

/**
 * In-memory fake ClickHouse client for tests.
 */
export function createRunsClickHouseFake(): RunsClickHouseClient & {
  readonly events: WideEvent[];
} {
  const events: WideEvent[] = [];
  return {
    events,
    async insert(_table: string, rows: readonly RunsRow[]): Promise<void> {
      for (const row of rows) {
        if (row.payload && typeof row.payload === "object") {
          events.push(row.payload as WideEvent);
        } else if (typeof row.payload === "string") {
          events.push(JSON.parse(row.payload) as WideEvent);
        }
      }
    },
    async query(sql: string): Promise<RunsRow[]> {
      const lower = sql.toLowerCase();
      if (lower.includes("count()")) {
        return [{ count: events.length }];
      }
      return events.map((e) => ({
        id: e.id,
        flow: e.flow,
        duration_ms: e.durationMs,
        cache: e.cache,
        tenant: e.tenant,
        subject_id: e.subjectId,
      }));
    },
  };
}

/**
 * ClickHouse runs driver.
 */
export const clickhouseRunsDriver: RunsDriver = {
  id: "clickhouse",
  async open(options: RunsOpenOptions = {}): Promise<RunsStore> {
    const client =
      (options.client as RunsClickHouseClient | undefined) ?? createRunsClickHouseFake();
    const table = options.name ?? "oke_runs";

    return {
      driverId: "clickhouse",
      async append(event: WideEvent): Promise<void> {
        await client.insert(table, [
          {
            id: event.id,
            flow: event.flow,
            duration_ms: event.durationMs,
            payload: event,
          },
        ]);
      },
      async flush(): Promise<void> {
        /* inserts are immediate in the fake */
      },
      async query(sql: string): Promise<RunsRow[]> {
        return client.query(sql);
      },
      async all(): Promise<WideEvent[]> {
        if ("events" in client) {
          return [...(client as { events: WideEvent[] }).events];
        }
        return [];
      },
      async close(): Promise<void> {
        /* fake has no resources */
      },
    };
  },
};
```

## Register and test

1. Add the id to `RunsDriverId` (or the element’s driver id union).
2. Put the factory in `DRIVER_BY_ID` (`src/runs/runtime.ts`).
3. Cover append + query in `src/runs/runs.test.ts` (see
   `"clickhouse driver appends and queries"`).
4. Pin the driver in an example or template `oke.config.ts` under `local` /
   `test` / `prod` / `docker` as appropriate.
5. Run:

```bash
bun test src/runs/runs.test.ts
bun run typecheck
```

## Governing rule reminder

> Adopt, don't reinvent; bind natively; name drivers after protocols.

Prefer the runtime’s native client when one exists. Never introduce a ninth
element for a new database or queue — bind it to Store, Signal, Clock, Vault,
Channel, or AI as the physics dictate.
