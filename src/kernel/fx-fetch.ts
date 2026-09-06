/**
 * `fx.fetch` body — lazy chunk so Store-only / edge graphs that never call
 * outbound HTTP do not pay for host parsing + dry-run stub strings.
 */

import type { EffectExternal } from "./effects.ts";
import { isDryRun, recordWouldHaveFired } from "./dry-run.ts";

/**
 * Hostname for `fx.fetch` capability / ledger resource.
 *
 * @param href - Absolute URL string
 */
export function hostFromFetchUrl(href: string): string {
  try {
    const host = new URL(href).hostname;
    if (host) return host;
  } catch {
    /* fall through */
  }
  throw new Error(`fx.fetch: invalid URL "${href}" — expected an absolute URL with a hostname`);
}

type Gated = <T>(
  kind: "fetch",
  resource: string,
  body: () => T | Promise<T>,
  externalOf?:
    | EffectExternal
    | ((result: T | undefined, error: unknown) => EffectExternal | undefined),
) => Promise<T>;

/**
 * Capability-gated outbound HTTP (always `external.kind: "third-party"`).
 *
 * @param gated - Flow `gated` helper
 * @param url - Absolute URL
 * @param init - Fetch init
 */
export function runFxFetch(
  gated: Gated,
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const href = typeof url === "string" ? url : url.href;
  const host = hostFromFetchUrl(href);
  return gated(
    "fetch",
    host,
    async () => {
      if (isDryRun()) {
        recordWouldHaveFired("fetch", host);
        return new Response(null, { status: 204 });
      }
      return globalThis.fetch(url, init);
    },
    { host, kind: "third-party" },
  );
}
