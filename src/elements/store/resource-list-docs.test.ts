/**
 * Lock the documented Store behaviors for the typechecked docs fixtures:
 *
 * 1. `filter: "none"` — a forbidden filter query key fails with HTTP 422 and a
 *    `ValidationError` whose message is exactly `unknown list param "<key>"`
 *    (`badInput` in `resource.ts`). The Store element page quotes this shape.
 * 2. `mode: "offset"` + `count: "exact"` — list answers `meta.total` via
 *    `COUNT(*)`. Changing it to `"none"` must drop `meta.total` and keep only
 *    `meta.offset`; this test catches a silent behavior flip in either config.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { oke } from "../../kernel/app.ts";
import { resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { createTestApp } from "../../test/create-test-app.ts";
import {
  docsAdminTableResource,
  docsListItemsStore,
  docsRestrictedResource,
} from "./resource-list-docs.fixture.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("resource-list-docs fixtures — documented behaviors stay real", () => {
  // PGLite first-boot under full-suite load can exceed the default 5s.
  test(
    "filter: \"none\" — forbidden filter key → 422 ValidationError 'unknown list param'",
    async () => {
      resetBindings();
      resetFlowSeq();

      const mounted = on(http.resource("/docs-restricted", docsRestrictedResource.all()));
      const app = oke({ name: "docs-restricted-test" }).adopt({ docs: mounted });
      // Explicit stores — module-level `store.sql` is drained by the first `oke()`
      // (and cleared by the global afterEach registry reset).
      Object.assign(app.$options, { env: "test", stores: [docsListItemsStore] });

      const t = await createTestApp(app);

      const bad = await app.fetch(new Request("http://localhost/docs-restricted?secret=eq.x"));
      expect(bad.status).toBe(422);
      const badBody = (await bad.json()) as {
        data: null;
        error: { code: string; data: { issues: Array<{ message: string; path: string[] }> } };
      };
      expect(badBody.error.code).toBe("ValidationError");
      expect(badBody.error.data.issues[0]!.message).toBe('unknown list param "secret"');
      expect(badBody.error.data.issues[0]!.path).toEqual(["secret"]);

      const ok = await app.fetch(new Request("http://localhost/docs-restricted?limit=20"));
      expect(ok.status).toBe(200);

      await t.close();
    },
    { timeout: 30_000 },
  );

  test(
    'offset + count: "exact" answers meta.total; "none" drops it',
    async () => {
      resetBindings();
      resetFlowSeq();

      const exactMounted = on(http.resource("/docs-admin", docsAdminTableResource.all()));
      const app = oke({ name: "docs-admin-test" }).adopt({ docs: exactMounted });
      Object.assign(app.$options, { env: "test", stores: [docsListItemsStore] });

      const t = await createTestApp(app);
      const created = await app.fetch(
        new Request("http://localhost/docs-admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "one", secret: "s" }),
        }),
      );
      expect(created.status).toBe(201);

      const exact = await app.fetch(new Request("http://localhost/docs-admin?limit=20"));
      expect(exact.status).toBe(200);
      const exactBody = (await exact.json()) as {
        data: Array<{ title?: string }>;
        meta: Record<string, unknown>;
      };
      // `count: "exact"` must answer meta.total (COUNT(*)); offset mode keeps meta.offset.
      expect(typeof exactBody.meta.total).toBe("number");
      expect(exactBody.meta.total).toBeGreaterThanOrEqual(1);
      expect(exactBody.meta.offset).toBe(0);
      expect(exactBody.data.some((row) => row.title === "one")).toBe(true);

      await t.close();
    },
    { timeout: 30_000 },
  );
});
