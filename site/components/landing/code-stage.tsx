/**
 * Homepage code stage — Shiki-highlight every starter file, then hand tabs
 * to the client. Same highlighter as docs so the snippet matches the handbook.
 */

import { highlight } from "fumadocs-core/highlight";
import { Fragment } from "react";
import { CodeStageTabs, type CodeStageFile } from "@/components/landing/code-stage-tabs";

export type { CodeStageFile };

/**
 * Tabbed live source: one platform, three real starter files.
 *
 * @param files - Filename, caption, and source for each tab
 */
export async function CodeStage({ files }: { readonly files: ReadonlyArray<CodeStageFile> }) {
  // Key each pane — React treats the prop array as a list of elements.
  const highlighted = await Promise.all(
    files.map(async (file) => {
      const node = await highlight(file.code, {
        lang: file.lang ?? "ts",
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      return <Fragment key={file.id}>{node}</Fragment>;
    }),
  );

  return <CodeStageTabs files={files} highlighted={highlighted} />;
}
