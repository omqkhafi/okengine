import { on, flow, http } from "okengine";

/**
 * `fx.raw` without an explicit `effects` annotation → cache-ineligible.
 */
export const escapeHatch = on(
  http.get("/raw"),
  flow("raw.unannotated", {
    do: async (_, fx) => {
      return fx.raw("select 1");
    },
  }),
);

/**
 * `fx.raw` with explicit effects stays cache-eligible (no cache: false).
 */
export const annotated = on(
  http.get("/raw-ok"),
  flow("raw.annotated", {
    effects: { reads: ["sql:orders"] },
    do: async (_, fx) => {
      return fx.raw("select * from orders");
    },
  }),
);
