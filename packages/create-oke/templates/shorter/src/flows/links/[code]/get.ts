import { on, flow, http, isFlowFailure } from "okengine/http";

import { member } from "@/core";
import { loadOwnedLink } from "../_shared";
import { Forbidden, LinkCodeIn, LinkOut, NotFound } from "../shapes";

/**
 * Fetch one of the caller's links by code.
 *
 * 1. Load by `code` (SELECT is open)
 * 2. Owner check in `do` → `Forbidden` for someone else's row
 */
export const get = on(
  http
    .get({ in: LinkCodeIn, out: LinkOut, errors: { NotFound, Forbidden } })
    .gate(member),
  flow({
    do: async (input, fx) => {
      const row = await loadOwnedLink(fx, input.code);
      if (isFlowFailure(row)) return row;
      return row;
    },
  }),
);
