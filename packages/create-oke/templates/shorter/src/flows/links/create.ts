import { on, flow, http, fail, isFlowFailure } from "okengine/http";

import { db, linksMutate, publicApiUrl } from "@/core";
import { links } from "@/db/schema";
import { isHttpUrl, publicShortUrl, resolveShortCode, warmRedirectCache } from "./_shared";
import { Conflict, InvalidUrl, LinkCreateIn, LinkOut } from "./shapes";
import { linkCreated } from "./signals";

/**
 * Create a short link (`POST /links`).
 *
 * 1. Reject non-http(s) destinations (`InvalidUrl`)
 * 2. Resolve `code` — custom alias or minted `okid` (`Conflict` if taken)
 * 3. Stamp `id` / `createdAt` from `fx` (epoch-ms; store coerces)
 * 4. Insert, cache the 302, emit `link-created`
 */
export const create = on(
  http.post({ in: LinkCreateIn, out: LinkOut, errors: { Conflict, InvalidUrl } }).gate(linksMutate),
  flow({
    do: async (input, fx) => {
      // Public 302 only follows http(s).
      if (!isHttpUrl(input.url)) return fail("InvalidUrl", { url: input.url });

      // `linksMutate` already verified the session; RLS insert-owner uses this.
      const userId = fx.auth.userId!;

      const code = await resolveShortCode(fx, input.code);
      if (isFlowFailure(code)) return code;

      // Identity + time are Flow effects so tests can freeze the clock.
      // Store coerces epoch-ms and ISO strings → Date for `timestamp` columns.
      const id = fx.id();
      const createdAt = fx.clock.now();
      const expiresAt = input.expiresAt ?? null;

      const [row] = await fx.store(db).insert(links).values({
        id,
        userId,
        code,
        url: input.url,
        clicks: 0,
        expiresAt,
        createdAt,
      }).returning();
      if (!row) return fail("Conflict", { code });

      await warmRedirectCache(fx, code, input.url, expiresAt);

      // Public origin is vault config — not a hardcoded host.
      const origin = await fx.vault.get(publicApiUrl);
      const shortUrl = publicShortUrl(origin.reveal(), code);
      await fx.emit(linkCreated, { id, code, url: input.url, shortUrl }, { key: id });
      return fx.json.create(row);
    },
  }),
);
