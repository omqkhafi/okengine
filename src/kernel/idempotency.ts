/**
 * HTTP idempotency policy.
 *
 * A flow honors `Idempotency-Key` when it is reached over HTTP as REST
 * non-GET or RPC, its inferred effects mutate or it uses `fx.raw`, and it
 * is not a stream, live feed, or binary response. The IETF draft this header
 * follows expired without becoming an RFC.
 *
 * @module
 */

import { parseDurationMs } from "../elements/clock/duration.ts";
import type { Effects } from "../manifest/types.ts";
import { fail } from "./errors.ts";
import type { EffectKind } from "./effects.ts";
import type { IdempotencyRow, StoredResponse } from "./idempotency-store.ts";

/** Request header. */
export const IDEMPOTENCY_HEADER = "idempotency-key";

/** Set on a replayed response. */
export const REPLAYED_HEADER = "idempotent-replayed";

/** Default TTL stamped when the flow omits one. */
export const IDEMPOTENCY_DEFAULT_TTL = "24h";

/** Author option on `flow({ idempotency })`. */
export type FlowIdempotencyOption =
  | false
  | "required"
  | { readonly required?: boolean; readonly ttl?: string };

/** Manifest / client stamp. */
export interface ResolvedIdempotency {
  readonly mode: "off" | "auto" | "required";
  readonly ttl: string;
}

const MUTATING: ReadonlySet<EffectKind> = new Set([
  "write",
  "emit",
  "send",
  "call",
  "fetch",
  "ask",
  "embed",
]);

const KEY_PATTERN = /^[\x20-\x7E]{16,255}$/;

/**
 * True when inferred effects include anything besides reads and secrets.
 *
 * @param effects - Declared or inferred effect set
 */
export function hasMutatingEffects(effects: Effects | undefined): boolean {
  if (effects === undefined) return false;
  return (
    (effects.writes?.length ?? 0) > 0 ||
    (effects.emits?.length ?? 0) > 0 ||
    (effects.sends?.length ?? 0) > 0 ||
    (effects.calls?.length ?? 0) > 0 ||
    (effects.fetches?.length ?? 0) > 0 ||
    (effects.asks?.length ?? 0) > 0 ||
    (effects.embeds?.length ?? 0) > 0
  );
}

/**
 * True when this HTTP entry should look at `Idempotency-Key`.
 *
 * @param args - Trigger shape and inferred effects
 */
export function idempotencyEligible(args: {
  readonly hasRequest: boolean;
  /** HTTP method. RPC is `POST`. */
  readonly method: string | undefined;
  readonly stream: boolean;
  readonly live: boolean;
  readonly effects: Effects | undefined;
  readonly usesRaw: boolean;
}): boolean {
  if (!args.hasRequest || args.stream || args.live) return false;
  const method = (args.method ?? "POST").toUpperCase();
  if (method === "GET") return false;
  return args.usesRaw || hasMutatingEffects(args.effects);
}

/** What this request should do with the header. */
export interface IdempotencyAttempt {
  readonly claiming: boolean;
  readonly mode: "off" | "auto" | "required";
  readonly ttlMs: number;
  readonly usesRaw: boolean;
}

/**
 * Decide whether this request claims a key.
 *
 * A stamped `required` flow still ignores the header when this entry is not
 * an eligible HTTP call (signal delivery, GET, stream, live, read-only).
 *
 * @param args - Flow stamp plus this request
 */
export function prepareIdempotencyAttempt(args: {
  readonly hasRequest: boolean;
  readonly method: string | undefined;
  readonly stream: boolean;
  readonly live: boolean;
  readonly effects: Effects | undefined;
  readonly usesRaw: boolean;
  readonly option: FlowIdempotencyOption | undefined;
  readonly resolved: ResolvedIdempotency | undefined;
  readonly header: string | null;
}): IdempotencyAttempt {
  const eligible = idempotencyEligible(args);
  const resolved = args.resolved ?? resolveIdempotencyMode(args.option, eligible);
  const mode = eligible ? resolved.mode : "off";
  const headerPresent = args.header !== null && args.header.trim().length > 0;
  const ttlMs = idempotencyTtlMs(resolved.ttl);
  return {
    claiming: mode === "required" || (mode === "auto" && headerPresent),
    mode,
    ttlMs: ttlMs > 0 ? ttlMs : 24 * 60 * 60 * 1000,
    usesRaw: args.usesRaw,
  };
}

/**
 * Resolve `off | auto | required` and the TTL string.
 *
 * Ineligible flows are `off` even when the option says required. Callers
 * that parse source should reject that combination before calling this.
 *
 * @param option - Author option
 * @param eligible - {@link idempotencyEligible}
 */
export function resolveIdempotencyMode(
  option: FlowIdempotencyOption | undefined,
  eligible: boolean,
): ResolvedIdempotency {
  const ttl = ttlOf(option);
  if (!eligible || option === false) return { mode: "off", ttl };
  if (option === "required") return { mode: "required", ttl };
  if (typeof option === "object" && option.required === true) return { mode: "required", ttl };
  return { mode: "auto", ttl };
}

/**
 * Parse a TTL string. `0` means the string is not a duration.
 *
 * @param ttl - Duration such as `24h`
 */
export function idempotencyTtlMs(ttl: string): number {
  return parseDurationMs(ttl);
}

/**
 * `user:<id>`, else `apikey:<id>`, else `anon`.
 *
 * @param auth - Principal after the gate
 */
export function idempotencyPrincipal(auth: {
  readonly userId: string | null;
  readonly apiKeyId?: string | null;
}): string {
  if (auth.userId !== null && auth.userId.length > 0) return `user:${auth.userId}`;
  if (auth.apiKeyId !== null && auth.apiKeyId !== undefined && auth.apiKeyId.length > 0) {
    return `apikey:${auth.apiKeyId}`;
  }
  return "anon";
}

/**
 * SHA-256 of canonical JSON `{ flow, input }`. Computed once at claim.
 *
 * @param flow - Flow name
 * @param input - Validated input
 */
export function idempotencyFingerprint(flow: string, input: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(canonicalJson({ flow, input }));
  return hasher.digest("hex");
}

/**
 * Classify a raw header value.
 *
 * @param header - Header value, or null when absent
 */
export function classifyIdempotencyKey(header: string | null): "missing" | "invalid" | string {
  if (header === null) return "missing";
  const key = header.trim();
  if (!KEY_PATTERN.test(key)) return "invalid";
  return key;
}

/**
 * True when this attempt recorded a non-read effect. Secrets do not count.
 * Failed attempts stay on the ledger.
 *
 * @param entries - This run's ledger
 */
export function attemptedMutation(entries: readonly { readonly kind: EffectKind }[]): boolean {
  return entries.some((entry) => MUTATING.has(entry.kind));
}

/**
 * Replay a stored response and mark it `Idempotent-Replayed`.
 *
 * @param row - Completed row
 */
export function replayResponse(row: IdempotencyRow): Response {
  const headers = new Headers();
  const contentType = row.responseHeaders?.contentType;
  const location = row.responseHeaders?.location;
  if (contentType !== undefined && contentType.length > 0) headers.set("content-type", contentType);
  if (location !== undefined && location.length > 0) headers.set("location", location);
  headers.set(REPLAYED_HEADER, "true");
  const status = row.responseStatus ?? 200;
  if (status === 204) return new Response(null, { status, headers });
  return new Response(row.responseBody ?? "", { status, headers });
}

/**
 * Protocol failure. `IdempotencyInProgress` also sets `Retry-After`.
 *
 * @param code - Builtin idempotency code
 * @param retryAfterSeconds - Seconds until the lease expires, for 409
 */
export function idempotencyErrorResponse(
  code:
    | "IdempotencyKeyMissing"
    | "IdempotencyKeyInvalid"
    | "IdempotencyKeyReused"
    | "IdempotencyInProgress",
  retryAfterSeconds?: number,
): Response {
  const failure = fail(
    code,
    code === "IdempotencyInProgress" ? { retryAfter: retryAfterSeconds } : {},
  );
  const headers = new Headers();
  if (code === "IdempotencyInProgress") {
    headers.set("retry-after", String(Math.max(1, retryAfterSeconds ?? 1)));
  }
  const status =
    code === "IdempotencyKeyReused" ? 422 : code === "IdempotencyInProgress" ? 409 : 400;
  return Response.json({ data: null, error: failure.error }, { status, headers });
}

/**
 * Buffer a JSON envelope for storage. Streams and non-JSON bodies return
 * undefined so the caller deletes the in-progress row.
 *
 * @param res - Encoded response (not the live stream)
 */
export async function storedFromResponse(res: {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}): Promise<StoredResponse | undefined> {
  const contentType = res.headers.get("content-type") ?? undefined;
  if (contentType?.includes("text/event-stream")) return undefined;
  if (
    contentType !== undefined &&
    !contentType.includes("json") &&
    !contentType.includes("text/") &&
    res.status !== 204
  ) {
    return undefined;
  }
  const location = res.headers.get("location") ?? undefined;
  const body = res.status === 204 ? "" : await res.text();
  return {
    status: res.status,
    body,
    ...(contentType !== undefined ? { contentType } : {}),
    ...(location !== undefined ? { location } : {}),
  };
}

/**
 * Author TTL, or {@link IDEMPOTENCY_DEFAULT_TTL}.
 *
 * @param option - Author option
 */
export function ttlOf(option: FlowIdempotencyOption | undefined): string {
  if (typeof option === "object" && option !== null && typeof option.ttl === "string") {
    return option.ttl;
  }
  return IDEMPOTENCY_DEFAULT_TTL;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
}
