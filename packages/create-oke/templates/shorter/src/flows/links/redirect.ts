import { on, flow, http, fail, isFlowFailure } from "okengine/http";

import { linksRedirect, redirects } from "@/core";
import {
  asRedirectCache,
  isExpired,
  loadLiveUrl,
  redirectTo,
} from "./_shared";
import { LinkCodeIn, NotFound } from "./shapes";
import { linkClicked } from "./signals";

/**
 * Public 302 (`GET /:code`).
 *
 * Explicit path — the file tree would stamp `/links/redirect`. Short URLs
 * must be root-level; static `/health` · `/links` · `/auth` still win.
 *
 * 1. KV first — hot path must not wait on SQL
 * 2. Expired cache → `NotFound` (do not fall through)
 * 3. SQL miss → live row, warm KV
 * 4. Emit `link-clicked` — clicks increment in the subscriber
 */
export const redirect = on(
  http.get("/:code", { in: LinkCodeIn, errors: { NotFound } }).gate(linksRedirect),
  flow({
    do: async (input, fx) => {
      const cached = asRedirectCache(await fx.store(redirects).get(input.code));
      if (cached) {
        // Expired cache is a miss for this request — expire job already
        // archived past `expiresAt`. Do not fall through to SQL.
        if (isExpired(cached.expiresAt, fx.clock.now())) {
          await fx.store(redirects).delete(input.code);
          return fail("NotFound", { code: input.code });
        }
        await fx.emit(linkClicked, { code: input.code }, { key: fx.id() });
        return redirectTo(cached.url);
      }

      const url = await loadLiveUrl(fx, input.code);
      if (isFlowFailure(url)) return url;
      await fx.emit(linkClicked, { code: input.code }, { key: fx.id() });
      return redirectTo(url);
    },
  }),
);
