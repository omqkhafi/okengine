/**
 * Files runs driver — Parquet + DuckDB (default in every environment).
 *
 * Locality is an engine detail: recent partitions sit on a local bucket;
 * older ones on optional object storage. Queries span both as one result set.
 * The user never declares archive tiers.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fsDriver } from "../../drivers/fs.ts";
import type { FilesBucket } from "../../drivers/types.ts";
import { okid } from "../../okid.ts";
import {
  duckPath,
  duckQuery,
  duckQueryWithTimeout,
  openDuckDB,
  type DuckSession,
} from "../duckdb.ts";
import {
  parquetUnionSql,
  partitionKey,
  partitionObjectKey,
  rowToWideEvent,
  wideEventToRow,
  writeParquet,
} from "../parquet.ts";
import { retentionKeepMs, shouldDropPartition } from "../retention.ts";
import {
  DEFAULT_RUNS_LOCAL_ROOT,
  type RunsDriver,
  type RunsOpenOptions,
  type RunsQueryOptions,
  type RunsRow,
  type RunsStore,
  type WideEvent,
} from "../types.ts";

/** Default hot window — 7 days. Older writes go to object storage when present. */
const DEFAULT_HOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Files (Parquet + DuckDB) runs driver.
 */
export const filesRunsDriver: RunsDriver = {
  id: "files",
  async open(options: RunsOpenOptions = {}): Promise<RunsStore> {
    const hotWindowMs = options.hotWindowMs ?? DEFAULT_HOT_WINDOW_MS;
    const clock = options.now ?? (() => Date.now());

    const localRoot = options.localRoot ?? resolve(process.cwd(), DEFAULT_RUNS_LOCAL_ROOT);
    if (!options.localBucket) {
      await mkdir(localRoot, { recursive: true });
    }

    const local: FilesBucket =
      options.localBucket ?? (await fsDriver.open({ name: "runs-local", root: localRoot }));

    const remote = options.remote?.bucket;
    const remotePrefix = options.remote?.prefix ?? "";

    const buffer: WideEvent[] = [];
    let queryScratch: string | undefined;
    let partitionFingerprint: string | undefined;
    let viewReady = false;
    const session: DuckSession = await openDuckDB();

    function chooseBucket(startedAt: number): {
      bucket: FilesBucket;
      keyPrefix: string;
      locality: "local" | "remote";
    } {
      const age = clock() - startedAt;
      if (remote && age > hotWindowMs) {
        return {
          bucket: remote,
          keyPrefix: remotePrefix,
          locality: "remote",
        };
      }
      return { bucket: local, keyPrefix: "", locality: "local" };
    }

    async function flushBuffer(): Promise<void> {
      if (buffer.length === 0) return;
      const groups = new Map<string, WideEvent[]>();
      for (const event of buffer) {
        const { locality } = chooseBucket(event.startedAt);
        const day = partitionKey(event.startedAt);
        const gkey = `${locality}:${day}`;
        const list = groups.get(gkey) ?? [];
        list.push(event);
        groups.set(gkey, list);
      }
      buffer.length = 0;

      for (const [gkey, events] of groups) {
        const [locality, day] = gkey.split(":") as ["local" | "remote", string];
        const target =
          locality === "remote" && remote
            ? { bucket: remote, keyPrefix: remotePrefix }
            : { bucket: local, keyPrefix: "" };
        const fileId = okid();
        const objectKey = `${target.keyPrefix}${partitionObjectKey(day!, fileId)}`;
        const tmpDir = await mkdtemp(join(tmpdir(), "oke-pq-"));
        const tmp = join(tmpDir, `${fileId}.parquet`);
        try {
          await writeParquet(
            tmp,
            events.map((e) => wideEventToRow(e)),
          );
          const bytes = new Uint8Array(await Bun.file(tmp).arrayBuffer());
          await target.bucket.put(objectKey, bytes);
        } finally {
          await rm(tmpDir, { recursive: true, force: true });
        }
      }
    }

    async function listPartitionKeys(): Promise<{
      readonly localKeys: readonly string[];
      readonly remoteKeys: readonly string[];
      readonly fingerprint: string;
    }> {
      const localKeys = (await local.list("runs/")).filter((k) => k.endsWith(".parquet")).sort();
      const remoteKeys = remote
        ? (await remote.list(`${remotePrefix}runs/`)).filter((k) => k.endsWith(".parquet")).sort()
        : [];
      return {
        localKeys,
        remoteKeys,
        fingerprint: `local:${localKeys.join("|")}||remote:${remoteKeys.join("|")}`,
      };
    }

    async function materialiseAllParquet(
      listed: Awaited<ReturnType<typeof listPartitionKeys>>,
    ): Promise<string[]> {
      if (queryScratch) {
        await rm(queryScratch, { recursive: true, force: true }).catch(() => undefined);
      }
      queryScratch = await mkdtemp(join(tmpdir(), "oke-runs-q-"));
      const paths: string[] = [];
      const sizes: string[] = [];

      for (const key of listed.localKeys) {
        const data = await local.get(key);
        if (!data) continue;
        const dest = join(queryScratch, key.replaceAll("/", "__"));
        await writeFile(dest, data);
        paths.push(dest);
        sizes.push(`${key}:${data.byteLength}`);
      }
      if (remote) {
        for (const key of listed.remoteKeys) {
          const data = await remote.get(key);
          if (!data) continue;
          const dest = join(queryScratch, `remote__${key.replaceAll("/", "__")}`);
          await writeFile(dest, data);
          paths.push(dest);
          sizes.push(`remote:${key}:${data.byteLength}`);
        }
      }
      partitionFingerprint = `${listed.fingerprint}||sizes:${sizes.join(",")}`;
      return paths;
    }

    async function ensureParquetView(): Promise<string[]> {
      await flushBuffer();
      await applyRetention();
      const listed = await listPartitionKeys();
      const cached =
        viewReady &&
        queryScratch !== undefined &&
        partitionFingerprint !== undefined &&
        partitionFingerprint.startsWith(`${listed.fingerprint}||sizes:`);
      const scratch = queryScratch;
      if (cached && scratch !== undefined) {
        const glob = new Bun.Glob("*.parquet");
        const paths: string[] = [];
        for await (const match of glob.scan({ cwd: scratch, onlyFiles: true })) {
          paths.push(join(scratch, match));
        }
        if (paths.length > 0) return paths.sort();
        viewReady = false;
      }
      const paths = await materialiseAllParquet(listed);
      if (paths.length === 0) {
        viewReady = false;
        return [];
      }
      const scan = await parquetUnionSql(session.conn, paths);
      await session.conn.run(`CREATE OR REPLACE VIEW runs AS ${scan}`);
      viewReady = true;
      return paths;
    }

    async function runUserSql(
      conn: DuckSession["conn"],
      sql: string,
      options?: RunsQueryOptions,
    ): Promise<RunsRow[]> {
      const timeoutMs = options?.timeoutMs;
      const rows =
        timeoutMs !== undefined
          ? await duckQueryWithTimeout(conn, sql, timeoutMs)
          : await duckQuery(conn, sql);
      if (options?.maxRows !== undefined && rows.length > options.maxRows) {
        return rows.slice(0, options.maxRows);
      }
      return rows;
    }

    async function applyRetention(): Promise<void> {
      const keepMs = retentionKeepMs(options.retention?.keep);
      if (keepMs == null) return;
      const now = clock();
      const dropFrom = async (bucket: FilesBucket, prefix: string): Promise<void> => {
        const keys = (await bucket.list(`${prefix}runs/`)).filter((k) => k.endsWith(".parquet"));
        for (const key of keys) {
          if (shouldDropPartition(key, now, keepMs)) {
            await bucket.delete(key);
          }
        }
      };
      await dropFrom(local, "");
      if (remote) await dropFrom(remote, remotePrefix);
    }

    await applyRetention();

    return {
      driverId: "files",
      async append(event: WideEvent): Promise<void> {
        buffer.push(event);
        if (buffer.length >= 256) await flushBuffer();
      },
      async flush(): Promise<void> {
        await flushBuffer();
        await applyRetention();
      },
      async query(sql: string, options?: RunsQueryOptions): Promise<RunsRow[]> {
        const paths = await ensureParquetView();
        if (paths.length === 0) return [];
        if (options?.sandbox !== true) {
          return runUserSql(session.conn, sql, options);
        }
        const scratch = queryScratch;
        if (scratch === undefined) return [];
        const snap = join(scratch, "_console_snap.parquet");
        await session.conn.run(
          `COPY (SELECT * FROM runs) TO '${duckPath(snap)}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
        );
        const isolated = await openDuckDB();
        try {
          await isolated.conn.run(
            `CREATE TABLE runs AS SELECT * FROM read_parquet('${duckPath(snap)}')`,
          );
          await isolated.conn.run("SET enable_external_access = false");
          return await runUserSql(isolated.conn, sql, options);
        } finally {
          isolated.close();
        }
      },
      async all(): Promise<WideEvent[]> {
        const paths = await ensureParquetView();
        if (paths.length === 0) return [];
        const rows = await duckQuery(session.conn, "SELECT * FROM runs");
        return rows.map((r) => rowToWideEvent(r));
      },
      async close(): Promise<void> {
        await flushBuffer();
        session.close();
        if (queryScratch) {
          await rm(queryScratch, { recursive: true, force: true }).catch(() => undefined);
        }
        await local.close();
        await remote?.close();
      },
    };
  },
};
