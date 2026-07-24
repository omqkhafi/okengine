/**
 * Minimal redis-call Lua host for Gate rate scripts (memory + fake redis).
 *
 * Supports the redis.call surface used by the five rate strategies:
 * GET · SET · INCR · EXPIRE · PTTL · DEL · ZADD · ZREMRANGEBYSCORE ·
 * ZCARD · ZRANGE · HGET · HSET · HMGET · HMSET · TIME.
 */

/** String / hash / zset entry with optional absolute expiry (epoch ms). */
type Entry =
  | { kind: "string"; value: string; expireAt?: number }
  | { kind: "hash"; fields: Map<string, string>; expireAt?: number }
  | {
      kind: "zset";
      members: Map<string, number>;
      expireAt?: number;
    };

/** In-process redis-like store used by Lua EVAL. */
export class LuaKvStore {
  readonly #data = new Map<string, Entry>();
  #nowMs: () => number;

  /**
   * @param nowMs - Clock for TTL / TIME (injectable for tests)
   */
  constructor(nowMs: () => number = () => Date.now()) {
    this.#nowMs = nowMs;
  }

  /** Replace the clock (time-travel). */
  setNow(nowMs: () => number): void {
    this.#nowMs = nowMs;
  }

  /** Current epoch ms. */
  now(): number {
    return this.#nowMs();
  }

  /**
   * Run a Gate rate Lua script against this store.
   *
   * @param script - Lua source (must match a known strategy script)
   * @param keys - KEYS
   * @param args - ARGV
   */
  eval(script: string, keys: readonly string[], args: readonly string[]): unknown {
    this.#purgeExpired();
    const handler = SCRIPT_HANDLERS.get(script.trim());
    if (!handler) {
      throw new Error("kv.eval: unknown Lua script (not a Gate rate strategy)");
    }
    return handler(this, keys, args);
  }

  /** redis.call("GET", key) */
  get(key: string): string | null {
    const e = this.#alive(key);
    if (!e || e.kind !== "string") return null;
    return e.value;
  }

  /** redis.call("SET", key, value, …) */
  set(key: string, value: string, mode?: "EX" | "PX", ttl?: number): "OK" {
    const entry: Entry = { kind: "string", value };
    if (mode === "EX" && ttl !== undefined) {
      entry.expireAt = this.#nowMs() + ttl * 1000;
    } else if (mode === "PX" && ttl !== undefined) {
      entry.expireAt = this.#nowMs() + ttl;
    }
    this.#data.set(key, entry);
    return "OK";
  }

  /** redis.call("INCR", key) */
  incr(key: string): number {
    const cur = this.get(key);
    const n = (cur === null ? 0 : Number(cur)) + 1;
    const prev = this.#data.get(key);
    this.#data.set(key, {
      kind: "string",
      value: String(n),
      expireAt: prev?.expireAt,
    });
    return n;
  }

  /** redis.call("EXPIRE", key, seconds) */
  expire(key: string, seconds: number): number {
    return this.pexpire(key, seconds * 1000);
  }

  /** redis.call("PEXPIRE", key, ms) */
  pexpire(key: string, ms: number): number {
    const e = this.#data.get(key);
    if (!e || this.#isExpired(e)) return 0;
    e.expireAt = this.#nowMs() + ms;
    return 1;
  }

  /** redis.call("PTTL", key) — ms remaining, -1 no expire, -2 missing. */
  pttl(key: string): number {
    const e = this.#data.get(key);
    if (!e || this.#isExpired(e)) return -2;
    if (e.expireAt === undefined) return -1;
    return Math.max(0, e.expireAt - this.#nowMs());
  }

  /** redis.call("DEL", …keys) */
  del(...keys: string[]): number {
    let n = 0;
    for (const k of keys) {
      if (this.#data.delete(k)) n++;
    }
    return n;
  }

  /** redis.call("ZADD", key, score, member) */
  zadd(key: string, score: number, member: string): number {
    let e = this.#alive(key);
    if (!e || e.kind !== "zset") {
      e = { kind: "zset", members: new Map() };
      this.#data.set(key, e);
    }
    const existed = e.members.has(member);
    e.members.set(member, score);
    return existed ? 0 : 1;
  }

  /** redis.call("ZREMRANGEBYSCORE", key, min, max) */
  zremrangebyscore(key: string, min: number, max: number): number {
    const e = this.#alive(key);
    if (!e || e.kind !== "zset") return 0;
    let n = 0;
    for (const [m, s] of e.members) {
      if (s >= min && s <= max) {
        e.members.delete(m);
        n++;
      }
    }
    return n;
  }

  /** redis.call("ZCARD", key) */
  zcard(key: string): number {
    const e = this.#alive(key);
    if (!e || e.kind !== "zset") return 0;
    return e.members.size;
  }

  /** redis.call("HMGET", key, …fields) */
  hmget(key: string, ...fields: string[]): (string | null)[] {
    const e = this.#alive(key);
    if (!e || e.kind !== "hash") return fields.map(() => null);
    return fields.map((f) => e.fields.get(f) ?? null);
  }

  /** redis.call("HSET", key, field, value, …) */
  hset(key: string, ...fieldValues: string[]): number {
    let e = this.#alive(key);
    if (!e || e.kind !== "hash") {
      e = { kind: "hash", fields: new Map() };
      this.#data.set(key, e);
    }
    let added = 0;
    for (let i = 0; i < fieldValues.length; i += 2) {
      const field = fieldValues[i]!;
      const value = fieldValues[i + 1]!;
      if (!e.fields.has(field)) added++;
      e.fields.set(field, value);
    }
    return added;
  }

  #alive(key: string): Entry | undefined {
    const e = this.#data.get(key);
    if (!e) return undefined;
    if (this.#isExpired(e)) {
      this.#data.delete(key);
      return undefined;
    }
    return e;
  }

  #isExpired(e: Entry): boolean {
    return e.expireAt !== undefined && e.expireAt <= this.#nowMs();
  }

  #purgeExpired(): void {
    for (const [k, e] of this.#data) {
      if (this.#isExpired(e)) this.#data.delete(k);
    }
  }
}

type ScriptHandler = (
  store: LuaKvStore,
  keys: readonly string[],
  args: readonly string[],
) => unknown;

const SCRIPT_HANDLERS = new Map<string, ScriptHandler>();

/**
 * Register a Lua script body with its TypeScript atomic handler.
 *
 * @param script - Exact Lua source (trimmed match)
 * @param handler - Atomic implementation
 */
export function registerLuaScript(script: string, handler: ScriptHandler): void {
  SCRIPT_HANDLERS.set(script.trim(), handler);
}

/**
 * Whether a script is registered (tests / diagnostics).
 *
 * @param script - Lua source
 */
export function hasLuaScript(script: string): boolean {
  return SCRIPT_HANDLERS.has(script.trim());
}
