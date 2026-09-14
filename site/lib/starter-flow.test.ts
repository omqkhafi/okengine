/**
 * Gate: homepage snippets must track the shorter starter Flows.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ELEMENTS } from "./elements.ts";
import { HERO_CODE_SOURCE } from "./hero-code.ts";
import { HERO_FX_BEATS, heroFxElementIndex } from "./hero-fx.ts";
import {
  CLIENT_CREATE_SNIPPET,
  loadCreateFlowSnippet,
  loadOnCreatedFlowSnippet,
  loadStarterFlowSnippet,
} from "./starter-flow.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STARTER_ROUTE = join(ROOT, "packages/create-oke/templates/shorter/src/flows/main/route.ts");
const STARTER_CREATE = join(
  ROOT,
  "packages/create-oke/templates/shorter/src/flows/links/create.ts",
);
const STARTER_ON_CREATED = join(
  ROOT,
  "packages/create-oke/templates/shorter/src/flows/links/signals.ts",
);

describe("loadStarterFlowSnippet", () => {
  test("reads the shorter starter route.ts", () => {
    expect(existsSync(STARTER_ROUTE)).toBe(true);
    const snippet = loadStarterFlowSnippet();
    expect(snippet.startsWith("export const root = on(")).toBe(true);
    expect(snippet).toContain("http.get({");
    expect(snippet).toContain("}).public()");
    expect(snippet).toContain('app: "shorter"');
    expect(snippet).not.toContain("export const health");
  });
});

describe("loadCreateFlowSnippet", () => {
  test("reads the shorter starter links create Flow", () => {
    expect(existsSync(STARTER_CREATE)).toBe(true);
    const snippet = loadCreateFlowSnippet();
    expect(snippet.startsWith("export const create = on(")).toBe(true);
    expect(snippet).toContain("http.post({");
    expect(snippet).toContain(".gate(linksMutate)");
    expect(snippet).toContain("fx.store(db).insert(links)");
  });

  test("every homepage fx-walk needle is in the displayed source, once per element", () => {
    const previews = HERO_FX_BEATS.map((beat) => beat.preview);
    expect(new Set(previews).size).toBe(ELEMENTS.length);
    expect(previews).toHaveLength(ELEMENTS.length);
    for (const beat of HERO_FX_BEATS) {
      expect(HERO_CODE_SOURCE.includes(beat.needle)).toBe(true);
      expect(heroFxElementIndex(beat.preview)).toBeGreaterThanOrEqual(0);
    }
    const create = loadCreateFlowSnippet();
    const onCreated = loadOnCreatedFlowSnippet();
    expect(create.includes("fx.vault.get(publicApiUrl)")).toBe(true);
    expect(create.includes("fx.clock.now()")).toBe(true);
    expect(create.includes("fx.store(db).insert(links)")).toBe(true);
    expect(create.includes("fx.emit(linkCreated")).toBe(true);
    expect(onCreated.includes("fx.send(linkCreatedMail")).toBe(true);
  });
});

describe("loadOnCreatedFlowSnippet", () => {
  test("reads the shorter starter links on-created Flow", () => {
    expect(existsSync(STARTER_ON_CREATED)).toBe(true);
    const snippet = loadOnCreatedFlowSnippet();
    expect(snippet.startsWith("export const onCreated = on(")).toBe(true);
    expect(snippet).toContain("fx.send(linkCreatedMail");
    expect(snippet).not.toContain("onClicked");
    expect(snippet).not.toContain("linkClicked");
  });
});

describe("CLIENT_CREATE_SNIPPET", () => {
  test("is the Try It createClient form calling starter links.create", () => {
    expect(CLIENT_CREATE_SNIPPET).toContain('from "okengine/client"');
    expect(CLIENT_CREATE_SNIPPET).toContain('createClient<App>("http://localhost:6530")');
    expect(CLIENT_CREATE_SNIPPET).toContain("api.links.create({");
    expect(CLIENT_CREATE_SNIPPET).toContain("const { data, error }");
  });
});
