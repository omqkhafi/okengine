/**
 * Doc-drift parser / containment unit tests.
 */

import { describe, expect, test } from "bun:test";
import {
  checkDocDrift,
  checkMermaidSyntax,
  normalizeTs,
  parseClaimedFences,
  parseMermaidFences,
} from "./doc-drift.ts";

describe("doc-drift", () => {
  test("normalizeTs trims trailing whitespace", () => {
    expect(normalizeTs("a  \n  b\t\n")).toBe("a\n  b");
  });

  test("parseClaimedFences picks headed typescript only", () => {
    const md = `# 1 · BASIC — Notes

### \`oke.config.ts\`

\`\`\`typescript
export default 1;
\`\`\`

Unheaded illustration:

\`\`\`typescript
const t = 1;
\`\`\`

# 2 · INTERMEDIATE — Linkly

### \`src/gates.ts\` — gates

\`\`\`ts
export const g = 1;
\`\`\`

# REFERENCE
`;
    const fences = parseClaimedFences(md);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toMatchObject({
      app: "notes",
      relPath: "oke.config.ts",
      body: "export default 1;",
    });
    expect(fences[1]).toMatchObject({
      app: "linkly",
      relPath: "src/gates.ts",
      body: "export const g = 1;",
    });
  });

  test("parseClaimedFences accepts examples/<app>/… headings without app sections", () => {
    const md = `## Quick start

### \`examples/notes/src/app.ts\`

\`\`\`typescript
export const app = 1;
\`\`\`

### \`examples/notes/src/flows/notes/index.ts\`

\`\`\`ts
export const create = 2;
\`\`\`

Unheaded:

\`\`\`typescript
const skip = true;
\`\`\`
`;
    const fences = parseClaimedFences(md);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toMatchObject({
      app: "notes",
      relPath: "src/app.ts",
      body: "export const app = 1;",
    });
    expect(fences[1]).toMatchObject({
      app: "notes",
      relPath: "src/flows/notes/index.ts",
      body: "export const create = 2;",
    });
  });

  test("checkDocDrift reports missing files", async () => {
    const { ok, failures } = await checkDocDrift(
      [
        {
          app: "notes",
          relPath: "does-not-exist.ts",
          body: "x",
          headingLine: 1,
        },
      ],
      import.meta.dir,
    );
    expect(ok).toBe(false);
    expect(failures[0]).toContain("does not contain claimed fence");
  });

  test("parseMermaidFences extracts mermaid blocks", () => {
    const md = `## Architecture

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`typescript
const skip = true;
\`\`\`
`;
    const fences = parseMermaidFences(md);
    expect(fences).toHaveLength(1);
    expect(fences[0]!.body).toContain("flowchart LR");
  });

  test("checkMermaidSyntax accepts valid flowchart", async () => {
    const { ok, failures } = await checkMermaidSyntax([
      {
        body: `flowchart TD
  code["your code"] -->|compile| manifest["manifest.oke.json"]
  manifest --> client["typed client (+ live queries)"]`,
        startLine: 1,
      },
    ]);
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  test("checkMermaidSyntax rejects invalid syntax", async () => {
    const { ok, failures } = await checkMermaidSyntax([
      { body: "flowchart LR\n  A-->", startLine: 9 },
    ]);
    expect(ok).toBe(false);
    expect(failures[0]).toContain("mermaid: invalid syntax (line 9)");
  });
});
