import { describe, expect, test } from "bun:test";

import {
  deepMatch,
  extractFromSources,
  extractManifest,
} from "./extract.ts";
import { emitManifest, manifestPathIn } from "./emit.ts";
import { serializeManifest } from "../manifest/validate.ts";
import type { Manifest } from "../manifest/types.ts";

const skyportRoot = new URL("./fixtures/skyport/", import.meta.url).pathname;
const goldenUrl = new URL("./fixtures/skyport.expected.json", import.meta.url);
const excerptUrl = new URL(
  "../manifest/fixtures/skyport.excerpt.json",
  import.meta.url,
);

async function loadSkyportFiles(): Promise<
  { path: string; source: string }[]
> {
  const glob = new Bun.Glob("**/*.{ts,tsx}");
  const files: { path: string; source: string }[] = [];
  for await (const path of glob.scan({ cwd: skyportRoot, onlyFiles: true })) {
    files.push({
      path,
      source: await Bun.file(`${skyportRoot}${path}`).text(),
    });
  }
  return files;
}

describe("extractManifest — Skyport", () => {
  test("golden-file comparison against committed expected manifest", async () => {
    const files = await loadSkyportFiles();
    const manifest = await extractManifest({ files });
    const expected = JSON.parse(await Bun.file(goldenUrl).text()) as Manifest;

    expect(manifest).toEqual(expected);

    // Also matches the spec excerpt (subset).
    const excerpt = JSON.parse(await Bun.file(excerptUrl).text()) as Manifest;
    expect(deepMatch(manifest, excerpt)).toBe(true);
  });

  test("emitManifest writes manifest.oke.json", async () => {
    const files = await loadSkyportFiles();
    const manifest = await extractManifest({ files });
    const dir = `${skyportRoot}.out`;
    await Bun.$`mkdir -p ${dir}`;
    const path = await emitManifest({
      path: manifestPathIn(dir),
      manifest,
    });
    const written = JSON.parse(await Bun.file(path).text()) as Manifest;
    expect(written.app).toBe("skyport");
    expect(written.oke).toBe("1.0");
    await Bun.$`rm -rf ${dir}`;
  });
});

describe("extractManifest — five trigger types", () => {
  test("effects inferred for http · every · signal · cdc · internal", async () => {
    const source = await Bun.file(
      new URL("./fixtures/triggers/five-triggers.ts", import.meta.url),
    ).text();
    const manifest = await extractFromSources({
      "src/flows/triggers.ts": source,
    });

    expect(manifest.flows?.["triggers.http"]?.trigger).toEqual({
      http: { method: "POST", path: "/orders" },
    });
    expect(manifest.flows?.["triggers.http"]?.effects?.writes).toEqual([
      "sql:orders",
    ]);

    expect(manifest.flows?.["triggers.every"]?.trigger).toEqual({
      every: "10m",
    });
    expect(manifest.flows?.["triggers.every"]?.effects?.writes).toEqual([
      "sql:links",
    ]);

    expect(manifest.flows?.["triggers.signal"]?.trigger).toEqual({
      signal: "link-clicked",
    });
    expect(manifest.flows?.["triggers.signal"]?.effects?.writes).toContain(
      "sql:links",
    );
    expect(manifest.flows?.["triggers.signal"]?.effects?.emits).toContain(
      "link-clicked",
    );

    expect(manifest.flows?.["triggers.cdc"]?.trigger).toEqual({
      cdc: { table: "orders", column: "status" },
    });
    expect(manifest.flows?.["triggers.cdc"]?.effects?.writes).toEqual([
      "sql:orders",
    ]);

    // internal trigger → no trigger key (call-only), or empty trigger object
    const internal = manifest.flows?.["triggers.internal"];
    expect(internal?.trigger === undefined || Object.keys(internal.trigger).length === 0).toBe(
      true,
    );
    expect(internal?.effects?.reads).toEqual(["sql:links"]);
  });
});

describe("extractManifest — fx.raw", () => {
  test("unannotated fx.raw is cache-ineligible; annotated is not", async () => {
    const source = await Bun.file(
      new URL("./fixtures/raw/raw-unannotated.ts", import.meta.url),
    ).text();
    const manifest = await extractFromSources({
      "src/flows/raw.ts": source,
    });

    expect(manifest.flows?.["raw.unannotated"]?.cache).toBe(false);
    expect(manifest.flows?.["raw.annotated"]?.cache).toBeUndefined();
    expect(manifest.flows?.["raw.annotated"]?.effects?.reads).toEqual([
      "sql:orders",
    ]);
  });
});

describe("extractManifest — performance", () => {
  test("200-flow synthetic app extracts in under 2s", async () => {
    const sources: Record<string, string> = {};
    const parts: string[] = [
      `import { on, flow, http, store } from "okengine";`,
      `export const db = store.sql("db");`,
      `export const items = { name: "items" };`,
      `export const app = { name: "synth" };`,
    ];
    // Declare oke name via a tiny app file pattern
    sources["src/app.ts"] = `
      import { oke } from "okengine";
      export const app = oke({ name: "synth200" });
    `;

    for (let i = 0; i < 200; i++) {
      parts.push(`
export const flow_${i} = on(
  http.get("/f/${i}"),
  flow({
    name: "synth.flow_${i}",
    do: async (input, fx) => {
      await fx.store(db).insert(items).values(input);
      const rows = await fx.store(db).select().from(items);
      return { n: rows.length, i: ${i} };
    },
  }),
);
`);
    }
    sources["src/flows/all.ts"] = parts.join("\n");

    const start = performance.now();
    const manifest = await extractFromSources(sources);
    const elapsed = performance.now() - start;

    expect(Object.keys(manifest.flows ?? {}).length).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("serializeManifest stability", () => {
  test("extracted Skyport round-trips through JSON", async () => {
    const files = await loadSkyportFiles();
    const manifest = await extractManifest({ files });
    const text = serializeManifest(manifest);
    const again = JSON.parse(text) as Manifest;
    expect(again).toEqual(manifest);
  });
});
