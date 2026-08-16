/**
 * Parquet partition types must stay stable across flushes.
 *
 * `read_json_auto` infers all-null `error_code` as JSON and a later
 * `"Unauthorized"` as VARCHAR — Console `listRuns` then 500s.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { duckPath, openDuckDB } from "./duckdb.ts";
import { createRunsRuntime } from "./runtime.ts";
import { readParquet, wideEventToRow, writeParquet, type ParquetRow } from "./parquet.ts";
import type { WideEvent } from "./types.ts";

const temps: string[] = [];

afterEach(async () => {
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function tmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "oke-pq-test-"));
  temps.push(d);
  return d;
}

function sample(id: string, errorCode: string | null): WideEvent {
  return {
    id,
    flow: "console.session.login",
    trigger: "http",
    plane: "operator",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    error: errorCode === null ? null : { code: errorCode },
    durationMs: 10,
    startedAt: Date.now(),
    endedAt: Date.now() + 10,
    dimensions: { flow: "console.session.login", error_code: errorCode },
  };
}

/** Old writer — `read_json_auto` with no type pin (existing on-disk partitions). */
async function writeLegacyParquet(path: string, rows: readonly ParquetRow[]): Promise<void> {
  const jsonl = `${path}.jsonl`;
  await Bun.write(jsonl, rows.map((r) => JSON.stringify(r)).join("\n"));
  const session = await openDuckDB();
  try {
    await session.conn.run(
      `COPY (SELECT * FROM read_json_auto('${duckPath(jsonl)}')) TO '${duckPath(path)}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
  } finally {
    session.close();
    await rm(jsonl, { force: true }).catch(() => undefined);
  }
}

describe("parquet error_code types", () => {
  test("readParquet unions all-null JSON error_code with VARCHAR Unauthorized", async () => {
    const dir = await tmpDir();
    const okPath = join(dir, "ok.parquet");
    const failPath = join(dir, "fail.parquet");
    await writeLegacyParquet(okPath, [wideEventToRow(sample("ok", null))]);
    await writeLegacyParquet(failPath, [wideEventToRow(sample("fail", "Unauthorized"))]);

    const rows = await readParquet([okPath, failPath]);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    expect(byId.get("ok")?.error_code ?? null).toBeNull();
    expect(byId.get("fail")?.error_code).toBe("Unauthorized");
  });

  test("writeParquet pins error_code so a later Unauthorized flush still reads", async () => {
    const dir = await tmpDir();
    const okPath = join(dir, "ok.parquet");
    const failPath = join(dir, "fail.parquet");
    await writeParquet(okPath, [wideEventToRow(sample("ok", null))]);
    await writeParquet(failPath, [wideEventToRow(sample("fail", "Unauthorized"))]);

    const rows = await readParquet([okPath, failPath]);
    expect(rows.map((r) => String(r.id)).sort()).toEqual(["fail", "ok"]);
  });

  test("files driver lists runs after a success flush then an Unauthorized flush", async () => {
    const root = await tmpDir();
    const runs = createRunsRuntime({ driver: "files", localRoot: root });
    await runs.open();
    await runs.append(sample("ok", null));
    await runs.flush();
    await runs.append(sample("fail", "Unauthorized"));
    await runs.flush();

    const all = await runs.all();
    expect(all.map((e) => e.id).sort()).toEqual(["fail", "ok"]);
    expect(all.find((e) => e.id === "fail")?.error?.code).toBe("Unauthorized");
    expect(all.find((e) => e.id === "ok")?.error).toBeNull();

    const rows = await runs.query("SELECT id, error_code FROM runs ORDER BY id");
    expect(rows.map((r) => String(r.id))).toEqual(["fail", "ok"]);
    expect(rows[0]?.error_code).toBe("Unauthorized");
    expect(rows[1]?.error_code ?? null).toBeNull();
    await runs.close();
  });
});
