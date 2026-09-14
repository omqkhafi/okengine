import { store } from "okengine";

import { daily } from "./daily.ts";
import { links } from "./links.ts";

/** `links` 1-to-n `daily` on `code`. */
export const relations = store.schema.relations({ links, daily }, (r) => ({
  links: {
    daily: r.many.daily({ from: r.links.code, to: r.daily.code }),
  },
  daily: {
    link: r.one.links({
      from: r.daily.code,
      to: r.links.code,
      optional: false,
    }),
  },
}));
