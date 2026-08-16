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
import { duckPath, duckQuery, openDuckDB, type DuckSession } from "../duckdb.ts";
import {
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
        const fileId = crypto.randomUUID();
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

    async function materialiseAllParquet(): Promise<string[]> {
      if (queryScratch) {
        await rm(queryScratch, { recursive: true, force: true }).catch(() => undefined);
      }
      queryScratch = await mkdtemp(join(tmpdir(), "oke-runs-q-"));
      const paths: string[] = [];

      const localKeys = (await local.list("runs/")).filter((k) => k.endsWith(".parquet"));
      for (const key of localKeys) {
        const data = await local.get(key);
        if (!data) continue;
        const dest = join(queryScratch, key.replaceAll("/", "__"));
        await writeFile(dest, data);
        paths.push(dest);
      }
      if (remote) {
        const prefix = `${remotePrefix}runs/`;
        const remoteKeys = (await remote.list(prefix)).filter((k) => k.endsWith(".parquet"));
        for (const key of remoteKeys) {
          const data = await remote.get(key);
          if (!data) continue;
          const dest = join(queryScratch, `remote__${key.replaceAll("/", "__")}`);
          await writeFile(dest, data);
          paths.push(dest);
        }
      }
      return paths;
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
      async query(sql: string): Promise<RunsRow[]> {
        await flushBuffer();
        await applyRetention();
        const paths = await materialiseAllParquet();
        if (paths.length === 0) return [];
        const list = paths.map((p) => `'${duckPath(p)}'`).join(", ");
        await session.conn.run(`DROP VIEW IF EXISTS runs`);
        await session.conn.run(
          `CREATE VIEW runs AS SELECT * FROM read_parquet([${list}], union_by_name = true)`,
        );
        return duckQuery(session.conn, sql);
      },
      async all(): Promise<WideEvent[]> {
        await flushBuffer();
        await applyRetention();
        const paths = await materialiseAllParquet();
        if (paths.length === 0) return [];
        const list = paths.map((p) => `'${duckPath(p)}'`).join(", ");
        const rows = await duckQuery(
          session.conn,
          `SELECT * FROM read_parquet([${list}], union_by_name = true)`,
        );
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
