/**
 * Five atomic rate-limit strategies — Lua on the kv driver.
 *
 * Default: `sliding-window-counter` (near-exact, two keys, no boundary bursts).
 *
 * Each strategy ships a Lua script plus a TypeScript handler registered on
 * {@link registerLuaScript} so memory / fake redis EVAL stay atomic and
 * isomorphic with real redis EVAL.
 */

import { registerLuaScript, type LuaKvStore } from "../../drivers/kv-lua.ts";
import type { RateStrategy } from "../../manifest/types.ts";

/** Result of a rate-limit take attempt. */
export interface RateTakeResult {
  /** Whether the request is allowed. */
  readonly allowed: boolean;
  /** Remaining tokens / slots after this take (−1 when unknown). */
  readonly remaining: number;
  /** Retry-after milliseconds when denied (0 when allowed). */
  readonly retryAfterMs: number;
}

/** Options for {@link takeRate}. */
export interface TakeRateOptions {
  readonly strategy: RateStrategy;
  readonly max: number;
  /** Window / refill period in milliseconds. */
  readonly windowMs: number;
  /** Subject key (ip, user id, …). */
  readonly subject: string;
  /** Epoch ms (defaults to Date.now). */
  readonly nowMs?: number;
}

/** Lua + key layout for one strategy. */
interface StrategyDef {
  readonly lua: string;
  readonly keyCount: number;
  keys(subject: string, nowMs: number, windowMs: number): string[];
  args(max: number, windowMs: number, nowMs: number): string[];
  parse(raw: unknown): RateTakeResult;
  run(store: LuaKvStore, keys: readonly string[], args: readonly string[]): unknown;
}

/** Pack `[allowed(0|1), remaining, retryAfterMs]`. */
function pack(allowed: boolean, remaining: number, retryAfterMs: number): number[] {
  return [allowed ? 1 : 0, remaining, retryAfterMs];
}

function parsePacked(raw: unknown): RateTakeResult {
  const arr = raw as number[];
  return {
    allowed: Number(arr[0]) === 1,
    remaining: Number(arr[1]),
    retryAfterMs: Number(arr[2]),
  };
}

// ── fixed-window ───────────────────────────────────────────────────────────

const FIXED_WINDOW_LUA = `
-- KEYS[1] = window bucket
-- ARGV: max, windowMs, nowMs
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], windowMs)
end
if n <= max then
  return {1, max - n, 0}
end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then pttl = windowMs end
return {0, 0, pttl}
`.trim();

const fixedWindow: StrategyDef = {
  lua: FIXED_WINDOW_LUA,
  keyCount: 1,
  keys(subject, nowMs, windowMs) {
    const bucket = Math.floor(nowMs / windowMs);
    return [`fw:${subject}:${bucket}`];
  },
  args(max, windowMs, nowMs) {
    return [String(max), String(windowMs), String(nowMs)];
  },
  parse: parsePacked,
  run(store, keys, args) {
    const max = Number(args[0]);
    const windowMs = Number(args[1]);
    const key = keys[0]!;
    const n = store.incr(key);
    if (n === 1) store.pexpire(key, windowMs);
    if (n <= max) return pack(true, max - n, 0);
    let pttl = store.pttl(key);
    if (pttl < 0) pttl = windowMs;
    return pack(false, 0, pttl);
  },
};

// ── sliding-window-counter ─────────────────────────────────────────────────

const SLIDING_WINDOW_COUNTER_LUA = `
-- KEYS[1]=curr KEYS[2]=prev
-- ARGV: max, windowMs, nowMs
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local curr = tonumber(redis.call('GET', KEYS[1]) or '0')
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local pos = now % windowMs
local weight = (windowMs - pos) / windowMs
local estimate = prev * weight + curr
if estimate + 1 > max then
  return {0, 0, windowMs - pos}
end
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], windowMs * 2)
end
local remaining = math.max(0, math.floor(max - (prev * weight + n)))
return {1, remaining, 0}
`.trim();

const slidingWindowCounter: StrategyDef = {
  lua: SLIDING_WINDOW_COUNTER_LUA,
  keyCount: 2,
  keys(subject, nowMs, windowMs) {
    const curr = Math.floor(nowMs / windowMs);
    return [`swc:${subject}:${curr}`, `swc:${subject}:${curr - 1}`];
  },
  args(max, windowMs, nowMs) {
    return [String(max), String(windowMs), String(nowMs)];
  },
  parse: parsePacked,
  run(store, keys, args) {
    const max = Number(args[0]);
    const windowMs = Number(args[1]);
    const now = Number(args[2]);
    const currKey = keys[0]!;
    const prevKey = keys[1]!;
    const curr = Number(store.get(currKey) ?? "0");
    const prev = Number(store.get(prevKey) ?? "0");
    const pos = now % windowMs;
    const weight = (windowMs - pos) / windowMs;
    const estimate = prev * weight + curr;
    if (estimate + 1 > max) {
      return pack(false, 0, windowMs - pos);
    }
    const n = store.incr(currKey);
    if (n === 1) store.pexpire(currKey, windowMs * 2);
    const remaining = Math.max(0, Math.floor(max - (prev * weight + n)));
    return pack(true, remaining, 0);
  },
};

// ── sliding-log ────────────────────────────────────────────────────────────

const SLIDING_LOG_LUA = `
-- KEYS[1] = zset of event ids by timestamp
-- ARGV: max, windowMs, nowMs, member
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - windowMs)
local count = redis.call('ZCARD', KEYS[1])
if count >= max then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = windowMs
  if oldest[2] then
    retry = math.max(0, tonumber(oldest[2]) + windowMs - now)
  end
  return {0, 0, retry}
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], windowMs)
return {1, max - count - 1, 0}
`.trim();

const slidingLog: StrategyDef = {
  lua: SLIDING_LOG_LUA,
  keyCount: 1,
  keys(subject) {
    return [`sl:${subject}`];
  },
  args(max, windowMs, nowMs) {
    return [String(max), String(windowMs), String(nowMs), `${nowMs}-${Math.random()}`];
  },
  parse: parsePacked,
  run(store, keys, args) {
    const max = Number(args[0]);
    const windowMs = Number(args[1]);
    const now = Number(args[2]);
    const member = args[3]!;
    const key = keys[0]!;
    store.zremrangebyscore(key, 0, now - windowMs);
    const count = store.zcard(key);
    if (count >= max) {
      // Approximate retry as full window (no ZRANGE WITHSCORES in host).
      return pack(false, 0, windowMs);
    }
    store.zadd(key, now, member);
    store.pexpire(key, windowMs);
    return pack(true, max - count - 1, 0);
  },
};

// ── token-bucket ───────────────────────────────────────────────────────────

const TOKEN_BUCKET_LUA = `
-- KEYS[1] = hash {tokens, ts}
-- ARGV: max, windowMs, nowMs
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local rate = max / windowMs
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = max
  ts = now
end
local elapsed = math.max(0, now - ts)
tokens = math.min(max, tokens + elapsed * rate)
if tokens < 1 then
  local need = (1 - tokens) / rate
  return {0, 0, math.ceil(need)}
end
tokens = tokens - 1
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], windowMs * 2)
return {1, math.floor(tokens), 0}
`.trim();

const tokenBucket: StrategyDef = {
  lua: TOKEN_BUCKET_LUA,
  keyCount: 1,
  keys(subject) {
    return [`tb:${subject}`];
  },
  args(max, windowMs, nowMs) {
    return [String(max), String(windowMs), String(nowMs)];
  },
  parse: parsePacked,
  run(store, keys, args) {
    const max = Number(args[0]);
    const windowMs = Number(args[1]);
    const now = Number(args[2]);
    const rate = max / windowMs;
    const key = keys[0]!;
    const data = store.hmget(key, "tokens", "ts");
    let tokens = data[0] === null ? max : Number(data[0]);
    let ts = data[1] === null ? now : Number(data[1]);
    const elapsed = Math.max(0, now - ts);
    tokens = Math.min(max, tokens + elapsed * rate);
    if (tokens < 1) {
      const need = (1 - tokens) / rate;
      return pack(false, 0, Math.ceil(need));
    }
    tokens -= 1;
    store.hset(key, "tokens", String(tokens), "ts", String(now));
    store.pexpire(key, windowMs * 2);
    return pack(true, Math.floor(tokens), 0);
  },
};

// ── leaky-bucket ───────────────────────────────────────────────────────────

const LEAKY_BUCKET_LUA = `
-- KEYS[1] = hash {level, ts}
-- ARGV: max, windowMs, nowMs
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local leak = max / windowMs
local data = redis.call('HMGET', KEYS[1], 'level', 'ts')
local level = tonumber(data[1])
local ts = tonumber(data[2])
if level == nil then
  level = 0
  ts = now
end
local elapsed = math.max(0, now - ts)
level = math.max(0, level - elapsed * leak)
if level + 1 > max then
  local over = level + 1 - max
  return {0, 0, math.ceil(over / leak)}
end
level = level + 1
redis.call('HSET', KEYS[1], 'level', level, 'ts', now)
redis.call('PEXPIRE', KEYS[1], windowMs * 2)
return {1, math.floor(max - level), 0}
`.trim();

const leakyBucket: StrategyDef = {
  lua: LEAKY_BUCKET_LUA,
  keyCount: 1,
  keys(subject) {
    return [`lb:${subject}`];
  },
  args(max, windowMs, nowMs) {
    return [String(max), String(windowMs), String(nowMs)];
  },
  parse: parsePacked,
  run(store, keys, args) {
    const max = Number(args[0]);
    const windowMs = Number(args[1]);
    const now = Number(args[2]);
    const leak = max / windowMs;
    const key = keys[0]!;
    const data = store.hmget(key, "level", "ts");
    let level = data[0] === null ? 0 : Number(data[0]);
    let ts = data[1] === null ? now : Number(data[1]);
    const elapsed = Math.max(0, now - ts);
    level = Math.max(0, level - elapsed * leak);
    if (level + 1 > max) {
      const over = level + 1 - max;
      return pack(false, 0, Math.ceil(over / leak));
    }
    level += 1;
    store.hset(key, "level", String(level), "ts", String(now));
    store.pexpire(key, windowMs * 2);
    return pack(true, Math.floor(max - level), 0);
  },
};

/** Strategy registry. */
export const RATE_STRATEGIES: Record<RateStrategy, StrategyDef> = {
  "fixed-window": fixedWindow,
  "sliding-window-counter": slidingWindowCounter,
  "sliding-log": slidingLog,
  "token-bucket": tokenBucket,
  "leaky-bucket": leakyBucket,
};

/** Default rate strategy (unified-theory §16). */
export const DEFAULT_RATE_STRATEGY: RateStrategy = "sliding-window-counter";

/** All five strategy ids. */
export const ALL_RATE_STRATEGIES: readonly RateStrategy[] = [
  "fixed-window",
  "sliding-window-counter",
  "sliding-log",
  "token-bucket",
  "leaky-bucket",
];

for (const def of Object.values(RATE_STRATEGIES)) {
  registerLuaScript(def.lua, (store, keys, args) => def.run(store, keys, args));
}

/**
 * Atomically take one slot from a rate limiter via kv EVAL.
 *
 * @param kv - KV namespace with `eval`
 * @param options - Strategy / max / window / subject
 */
export async function takeRate(
  kv: {
    eval<T = unknown>(
      script: string,
      keys: readonly string[],
      args?: readonly string[],
    ): Promise<T>;
  },
  options: TakeRateOptions,
): Promise<RateTakeResult> {
  const def = RATE_STRATEGIES[options.strategy];
  const nowMs = options.nowMs ?? Date.now();
  const keys = def.keys(options.subject, nowMs, options.windowMs);
  const args = def.args(options.max, options.windowMs, nowMs);
  const raw = await kv.eval(def.lua, keys, args);
  return def.parse(raw);
}

/**
 * Lua source for a strategy (for redis EVAL / diagnostics).
 *
 * @param strategy - Strategy id
 */
export function luaForStrategy(strategy: RateStrategy): string {
  return RATE_STRATEGIES[strategy].lua;
}
