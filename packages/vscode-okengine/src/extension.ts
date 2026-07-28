/**
 * OKE VS Code extension — effects CodeLens MVP (read-only).
 *
 * Runs the real oxc Manifest extractor on open/save for TypeScript files
 * that contain `flow(`. Debounce: {@link EXTRACT_DEBOUNCE_MS} (300ms) —
 * measured notes/skyport extracts are sub-second; coalescing rapid saves
 * avoids overlapping CPU-bound oxc walks without guessing a larger delay.
 */

import * as vscode from "vscode";
import {
  EXTRACT_DEBOUNCE_MS,
  lensesForFile,
  type FlowEffectsLens,
} from "./extract-bridge.ts";
import type { SourceFile } from "../../../src/compiler/extract.ts";

/** Cache: workspace-relative path → lenses. */
const cache = new Map<string, FlowEffectsLens[]>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Activate the extension.
 *
 * @param context - VS Code extension context
 */
export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    { language: "typescript", scheme: "file" },
    { language: "typescriptreact", scheme: "file" },
  ];

  const provider = new EffectsCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, provider),
    vscode.commands.registerCommand("oke.refreshEffectsCodeLens", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) scheduleExtract(editor.document, provider, 0);
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (shouldExtract(doc)) scheduleExtract(doc, provider, 0);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (shouldExtract(doc)) {
        scheduleExtract(doc, provider, EXTRACT_DEBOUNCE_MS);
      }
    }),
  );

  for (const doc of vscode.workspace.textDocuments) {
    if (shouldExtract(doc)) scheduleExtract(doc, provider, 0);
  }
}

/** Deactivate — clear timers. */
export function deactivate(): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  cache.clear();
}

/**
 * @param doc - Text document
 */
function shouldExtract(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== "file") return false;
  if (doc.languageId !== "typescript" && doc.languageId !== "typescriptreact") {
    return false;
  }
  return doc.getText().includes("flow(");
}

/**
 * @param doc - Document
 * @param provider - CodeLens provider
 * @param delayMs - Debounce delay
 */
function scheduleExtract(
  doc: vscode.TextDocument,
  provider: EffectsCodeLensProvider,
  delayMs: number,
): void {
  const key = doc.uri.toString();
  const prev = pending.get(key);
  if (prev) clearTimeout(prev);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      void runExtract(doc, provider);
    }, delayMs),
  );
}

/**
 * @param doc - Document
 * @param provider - Provider to refresh
 */
async function runExtract(
  doc: vscode.TextDocument,
  provider: EffectsCodeLensProvider,
): Promise<void> {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!folder) return;
  const rel = vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, "/");
  try {
    const files = await collectSources(folder.uri, doc);
    const lenses = await lensesForFile(rel, files);
    cache.set(rel, lenses);
    provider.refresh();
  } catch (err) {
    console.error("[oke] extract failed", err);
  }
}

/**
 * Gather TS sources under the workspace root for binding accuracy.
 * Caps file count for editor responsiveness; prefers src/ when present.
 *
 * @param root - Workspace folder URI
 * @param openDoc - Currently open document (always included, latest text)
 */
async function collectSources(
  root: vscode.Uri,
  openDoc: vscode.TextDocument,
): Promise<SourceFile[]> {
  const openRel = vscode.workspace
    .asRelativePath(openDoc.uri, false)
    .replace(/\\/g, "/");
  const pattern = new vscode.RelativePattern(root, "**/*.{ts,tsx}");
  const uris = await vscode.workspace.findFiles(
    pattern,
    "**/node_modules/**",
    400,
  );

  const files: SourceFile[] = [];
  const seen = new Set<string>();

  for (const uri of uris) {
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    if (
      rel.includes("/.") ||
      rel.endsWith(".test.ts") ||
      rel.endsWith(".test.tsx")
    ) {
      continue;
    }
    seen.add(rel);
    if (rel === openRel) {
      files.push({ path: rel, source: openDoc.getText() });
      continue;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    files.push({ path: rel, source: Buffer.from(bytes).toString("utf8") });
  }

  if (!seen.has(openRel)) {
    files.push({ path: openRel, source: openDoc.getText() });
  }
  return files;
}

/** CodeLens provider backed by the extractor cache. */
class EffectsCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  /** Invalidate lenses. */
  refresh(): void {
    this.emitter.fire();
  }

  /**
   * @param document - Open document
   * @param _token - Cancellation
   */
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const rel = vscode.workspace
      .asRelativePath(document.uri, false)
      .replace(/\\/g, "/");
    const lenses = cache.get(rel) ?? [];
    return lenses.map((lens) => {
      const line = Math.min(lens.line, Math.max(0, document.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      return new vscode.CodeLens(range, {
        title: lens.title,
        command: "",
        tooltip: `OKE flow ${lens.flowId}`,
      });
    });
  }
}
