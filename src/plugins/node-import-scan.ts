/**
 * Oxc scan for direct `node:` / `bun:` imports that bypass `fx`.
 *
 * Reuses Prompt 7's `oxc-parser` + `walk` — does not reimplement a parser.
 */

import { parseSync } from "oxc-parser";
import { walk, type AstNode } from "../compiler/effects-infer.ts";

/** One bypassing import finding. */
export interface NodeImportFinding {
  readonly source: string;
  readonly specifier: string;
  readonly line: number | null;
}

/** Source file input. */
export interface ScanSourceFile {
  readonly path: string;
  readonly source: string;
}

/**
 * Scan sources for `node:` / `bun:` imports (static + dynamic).
 *
 * @param files - Plugin package sources
 */
export function scanNodeImportsBypassingFx(
  files: readonly ScanSourceFile[],
): readonly NodeImportFinding[] {
  const out: NodeImportFinding[] = [];
  for (const file of files) {
    let program: unknown;
    try {
      const result = parseSync(file.path, file.source, {
        sourceType: "module",
        lang: file.path.endsWith(".tsx") ? "tsx" : "ts",
      });
      program = result.program;
    } catch {
      continue;
    }
    walk(program, (node) => {
      const specifier = importSpecifier(node);
      if (!specifier) return;
      if (!specifier.startsWith("node:") && !specifier.startsWith("bun:")) {
        return;
      }
      out.push({
        source: file.path,
        specifier,
        line: typeof node.start === "number" ? lineAt(file.source, node.start) : null,
      });
    });
  }
  return out;
}

function importSpecifier(node: AstNode): string | null {
  if (node.type === "ImportDeclaration") {
    const src = (node as AstNode & { source?: { value?: unknown } }).source;
    return typeof src?.value === "string" ? src.value : null;
  }
  if (node.type === "ImportExpression") {
    const arg = (node as AstNode & { source?: AstNode }).source;
    if (arg?.type === "Literal" || arg?.type === "StringLiteral") {
      const value = (arg as unknown as { value?: unknown }).value;
      if (typeof value === "string") return value;
    }
  }
  if (node.type === "CallExpression") {
    const call = node as AstNode & {
      callee?: AstNode;
      arguments?: AstNode[];
    };
    const callee = call.callee;
    const isRequire =
      callee?.type === "Identifier" && (callee as { name?: string }).name === "require";
    if (!isRequire) return null;
    const arg0 = call.arguments?.[0];
    if (arg0 && (arg0.type === "Literal" || arg0.type === "StringLiteral")) {
      const value = (arg0 as unknown as { value?: unknown }).value;
      if (typeof value === "string") return value;
    }
  }
  return null;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}
