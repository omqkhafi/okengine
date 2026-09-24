/**
 * One index of project functions that receive `fx`, built from ASTs
 * extract already parsed. Inference follows a call that passes `fx`
 * through this index — it does not re-parse or walk the filesystem.
 */

import {
  identifierName,
  stringArg,
  type AstNode,
  type FxCalleeResolution,
} from "./effects-infer.ts";

/** One `tsconfig` `paths` entry (`@/*` → `./src/*`). */
export interface TsconfigPath {
  readonly pattern: string;
  readonly targets: readonly string[];
}

/** Resolve a callee in one indexed file. */
export interface FxIndex {
  /**
   * Resolve `callee` as seen from `file`.
   *
   * @param file - File that contains the call
   * @param callee - Call callee node
   */
  resolve(file: string, callee: AstNode): FxCalleeResolution;
}

interface NamedImport {
  readonly kind: "named";
  readonly from: string;
  readonly imported: string;
}

interface NamespaceImport {
  readonly kind: "namespace";
  readonly from: string;
}

interface IntrinsicImport {
  readonly kind: "intrinsic";
  readonly name: "liveQuery" | "applySearchEmbedCdc";
}

type ImportBinding = NamedImport | NamespaceImport | IntrinsicImport;

interface LocalExport {
  readonly kind: "local";
  readonly binding: string;
}

interface Reexport {
  readonly kind: "reexport";
  readonly from: string;
  readonly imported: string;
}

interface FileFx {
  readonly functions: Map<string, AstNode>;
  readonly imports: Map<string, ImportBinding>;
  readonly exports: Map<string, LocalExport | Reexport>;
}

const INTRINSIC_SOURCES: Readonly<
  Record<string, Readonly<Record<string, "liveQuery" | "applySearchEmbedCdc">>>
> = {
  okengine: { liveQuery: "liveQuery" },
  "okengine/store": { liveQuery: "liveQuery", applySearchEmbedCdc: "applySearchEmbedCdc" },
};

/**
 * Read `compilerOptions.paths` from `tsconfig.json` when `rootDir` is set.
 *
 * @param rootDir - App root
 */
export async function readTsconfigPaths(rootDir: string): Promise<readonly TsconfigPath[]> {
  const file = Bun.file(`${rootDir}/tsconfig.json`);
  if (!(await file.exists())) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const options = (parsed as { compilerOptions?: unknown }).compilerOptions;
  if (typeof options !== "object" || options === null) return [];
  const paths = (options as { paths?: unknown }).paths;
  if (typeof paths !== "object" || paths === null) return [];
  const out: TsconfigPath[] = [];
  for (const [pattern, target] of Object.entries(paths)) {
    if (!Array.isArray(target)) continue;
    const targets = target.filter((item): item is string => typeof item === "string");
    if (targets.length > 0) out.push({ pattern, targets });
  }
  return out;
}

/**
 * Index top-level functions and import/export bindings for `fx` following.
 *
 * @param files - Parsed sources (path → program)
 * @param paths - `tsconfig` paths, empty when there is no root
 */
export function buildFxIndex(
  files: readonly { readonly path: string; readonly program: AstNode }[],
  paths: readonly TsconfigPath[] = [],
): FxIndex {
  const known = new Set(files.map((file) => normalizePosix(file.path)));
  const byFile = new Map<string, FileFx>();
  for (const file of files) {
    byFile.set(normalizePosix(file.path), indexFile(file.program));
  }

  function resolveModule(fromFile: string, spec: string): string | undefined {
    if (spec.startsWith(".")) {
      const dir = posixDir(fromFile);
      return matchFile(normalizePosix(dir.length > 0 ? `${dir}/${spec}` : spec), known);
    }
    for (const entry of paths) {
      const star = entry.pattern.indexOf("*");
      if (star < 0) {
        if (spec !== entry.pattern) continue;
        for (const target of entry.targets) {
          const hit = matchFile(normalizePosix(target), known);
          if (hit) return hit;
        }
        continue;
      }
      const prefix = entry.pattern.slice(0, star);
      const suffix = entry.pattern.slice(star + 1);
      if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
      const mid = spec.slice(prefix.length, spec.length - suffix.length);
      for (const target of entry.targets) {
        const hit = matchFile(normalizePosix(target.replace("*", mid)), known);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  function resolveExport(file: string, exportName: string, seen: Set<string>): FxCalleeResolution {
    const key = `${file}#${exportName}`;
    if (seen.has(key)) return { kind: "unresolved", label: exportName };
    seen.add(key);
    const indexed = byFile.get(file);
    if (!indexed) return { kind: "unresolved", label: exportName };
    const exported = indexed.exports.get(exportName);
    if (!exported) {
      const fn = indexed.functions.get(exportName);
      if (fn) return { kind: "function", fn, file };
      return { kind: "unresolved", label: exportName };
    }
    if (exported.kind === "local") return resolveBinding(file, exported.binding, seen);
    const target = resolveModule(file, exported.from);
    if (!target) return { kind: "unresolved", label: exportName };
    return resolveExport(target, exported.imported, seen);
  }

  function resolveBinding(file: string, name: string, seen: Set<string>): FxCalleeResolution {
    const key = `${file}#local:${name}`;
    if (seen.has(key)) return { kind: "unresolved", label: name };
    seen.add(key);
    const indexed = byFile.get(file);
    if (!indexed) return { kind: "unresolved", label: name };
    const fn = indexed.functions.get(name);
    if (fn) return { kind: "function", fn, file };
    const imported = indexed.imports.get(name);
    if (!imported) return { kind: "unresolved", label: name };
    if (imported.kind === "intrinsic") return { kind: "intrinsic", name: imported.name };
    if (imported.kind === "namespace") return { kind: "unresolved", label: name };
    const target = resolveModule(file, imported.from);
    if (!target) return { kind: "unresolved", label: name };
    return resolveExport(target, imported.imported, seen);
  }

  return {
    resolve(file, callee) {
      const from = normalizePosix(file);
      const seen = new Set<string>();
      if (callee.type === "Identifier") {
        const name = identifierName(callee) ?? "callee";
        return resolveBinding(from, name, seen);
      }
      if (callee.type === "MemberExpression") {
        const member = callee as AstNode & {
          object: AstNode;
          property: AstNode;
          computed?: boolean;
        };
        if (member.computed === true) return { kind: "unresolved", label: "callee" };
        const objectName = identifierName(member.object);
        const prop = identifierName(member.property);
        if (!objectName || !prop) return { kind: "unresolved", label: "callee" };
        const indexed = byFile.get(from);
        const imported = indexed?.imports.get(objectName);
        if (!imported || imported.kind !== "namespace") {
          return { kind: "unresolved", label: prop };
        }
        const target = resolveModule(from, imported.from);
        if (!target) return { kind: "unresolved", label: prop };
        return resolveExport(target, prop, seen);
      }
      return { kind: "unresolved", label: "callee" };
    },
  };
}

function indexFile(program: AstNode): FileFx {
  const functions = new Map<string, AstNode>();
  const imports = new Map<string, ImportBinding>();
  const exports = new Map<string, LocalExport | Reexport>();
  const body = (program as AstNode & { body?: AstNode[] }).body ?? [];
  for (const stmt of body) indexStmt(stmt, functions, imports, exports);
  return { functions, imports, exports };
}

function indexStmt(
  stmt: AstNode,
  functions: Map<string, AstNode>,
  imports: Map<string, ImportBinding>,
  exports: Map<string, LocalExport | Reexport>,
): void {
  if (stmt.type === "ImportDeclaration") {
    indexImport(stmt, imports);
    return;
  }
  if (stmt.type === "FunctionDeclaration") {
    rememberFunction(stmt, functions, exports, true);
    return;
  }
  if (stmt.type === "VariableDeclaration") {
    rememberVars(stmt, functions, exports, false);
    return;
  }
  if (stmt.type === "ExportDefaultDeclaration") {
    const decl = (stmt as AstNode & { declaration?: AstNode }).declaration;
    if (decl && isFunctionNode(decl)) {
      functions.set("default", decl);
      exports.set("default", { kind: "local", binding: "default" });
    }
    return;
  }
  if (stmt.type !== "ExportNamedDeclaration") return;
  const decl = (stmt as AstNode & { declaration?: AstNode | null }).declaration;
  const source = stringArg((stmt as AstNode & { source?: AstNode }).source);
  if (decl?.type === "FunctionDeclaration") rememberFunction(decl, functions, exports, true);
  if (decl?.type === "VariableDeclaration") rememberVars(decl, functions, exports, true);
  const specifiers = (stmt as AstNode & { specifiers?: AstNode[] }).specifiers ?? [];
  for (const spec of specifiers) {
    const local = exportedLocalName(spec);
    const exported = exportedPublicName(spec) ?? local;
    if (!local || !exported) continue;
    if (source) {
      exports.set(exported, { kind: "reexport", from: source, imported: local });
    } else {
      exports.set(exported, { kind: "local", binding: local });
    }
  }
}

function indexImport(stmt: AstNode, imports: Map<string, ImportBinding>): void {
  const source = stringArg((stmt as AstNode & { source?: AstNode }).source);
  if (!source) return;
  const specifiers = (stmt as AstNode & { specifiers?: AstNode[] }).specifiers ?? [];
  const intrinsics = INTRINSIC_SOURCES[source];
  for (const spec of specifiers) {
    if (spec.type === "ImportNamespaceSpecifier") {
      const local = identifierName((spec as AstNode & { local?: AstNode }).local);
      if (local) imports.set(local, { kind: "namespace", from: source });
      continue;
    }
    if (spec.type === "ImportDefaultSpecifier") {
      const local = identifierName((spec as AstNode & { local?: AstNode }).local);
      if (local) imports.set(local, { kind: "named", from: source, imported: "default" });
      continue;
    }
    if (spec.type !== "ImportSpecifier") continue;
    const local = identifierName((spec as AstNode & { local?: AstNode }).local);
    const imported =
      identifierName((spec as AstNode & { imported?: AstNode }).imported) ??
      stringArg((spec as AstNode & { imported?: AstNode }).imported) ??
      local;
    if (!local || !imported) continue;
    const intrinsic = intrinsics?.[imported];
    if (intrinsic) {
      imports.set(local, { kind: "intrinsic", name: intrinsic });
      continue;
    }
    imports.set(local, { kind: "named", from: source, imported });
  }
}

function rememberFunction(
  fn: AstNode,
  functions: Map<string, AstNode>,
  exports: Map<string, LocalExport | Reexport>,
  exportIt: boolean,
): void {
  const name = identifierName((fn as AstNode & { id?: AstNode }).id);
  if (!name) return;
  functions.set(name, fn);
  if (exportIt) exports.set(name, { kind: "local", binding: name });
}

function rememberVars(
  decl: AstNode,
  functions: Map<string, AstNode>,
  exports: Map<string, LocalExport | Reexport>,
  exportIt: boolean,
): void {
  const declarations = (decl as AstNode & { declarations?: AstNode[] }).declarations ?? [];
  for (const item of declarations) {
    const name = identifierName((item as AstNode & { id?: AstNode }).id);
    if (!name) continue;
    const init = (item as AstNode & { init?: AstNode | null }).init;
    if (init && isFunctionNode(unwrapValue(init))) functions.set(name, unwrapValue(init));
    if (exportIt) exports.set(name, { kind: "local", binding: name });
  }
}

function exportedLocalName(spec: AstNode): string | undefined {
  return (
    identifierName((spec as AstNode & { local?: AstNode }).local) ??
    stringArg((spec as AstNode & { local?: AstNode }).local)
  );
}

function exportedPublicName(spec: AstNode): string | undefined {
  return (
    identifierName((spec as AstNode & { exported?: AstNode }).exported) ??
    stringArg((spec as AstNode & { exported?: AstNode }).exported)
  );
}

function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

function unwrapValue(node: AstNode): AstNode {
  let current = node;
  for (let i = 0; i < 8; i++) {
    if (
      current.type === "ParenthesizedExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "AwaitExpression"
    ) {
      const inner = (current as AstNode & { expression?: AstNode; argument?: AstNode }).expression;
      const arg = (current as AstNode & { argument?: AstNode }).argument;
      const next = inner ?? arg;
      if (!next) break;
      current = next;
      continue;
    }
    break;
  }
  return current;
}

function matchFile(path: string, known: ReadonlySet<string>): string | undefined {
  const stripped = path.replace(/\.(ts|tsx|mts|cts)$/, "");
  const candidates = [
    path,
    stripped,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.mts`,
    `${stripped}/index.ts`,
    `${stripped}/index.tsx`,
  ];
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

function normalizePosix(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function posixDir(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash < 0 ? "" : file.slice(0, slash);
}
