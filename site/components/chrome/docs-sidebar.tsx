/**
 * Docs sidebar — a fixed pane rendered as a sibling of Fumadocs' `DocsLayout`
 * (whose own sidebar is disabled). Structure adapted from better-auth/better-auth
 * `docs/components/docs/docs-sidebar.tsx` under the MIT License. Copyright (c)
 * 2024 - present, Bereket Engida. See site/NOTICE.
 *
 * The nav is driven by the Fumadocs page tree, not a hand-written list, so
 * `meta.json` stays the single source of navigation truth.
 */

"use client";

import { ChevronDown, GitBranch, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "@fumadocs/base-ui/contexts/search";
import { ThemeSwitch } from "@fumadocs/base-ui/layouts/shared/slots/theme-switch";
import type * as PageTree from "fumadocs-core/page-tree";
import { useMemo, useState, type ReactNode } from "react";
import { GithubMark } from "@/components/chrome/icons";
import { cn } from "@/lib/cn";
import { OKE_VERSION } from "@/lib/elements";
import { gitConfig } from "@/lib/shared";

/** Folders are the accordion groups; everything else renders flat. */
function isFolder(node: PageTree.Node): node is PageTree.Folder {
  return node.type === "folder";
}

/**
 * Stable accordion key for a folder. `$id` is optional on the tree, so fall back
 * to the position — the tree order is deterministic across renders.
 *
 * @param node - Folder node
 * @param index - Position among the root's children
 */
function folderKey(node: PageTree.Folder, index: number): string {
  return node.$id ?? `folder-${index}`;
}

/**
 * Whether a URL is the current page or an ancestor of it.
 *
 * @param url - Candidate URL
 * @param pathname - Current pathname
 */
function isUrlActive(url: string, pathname: string): boolean {
  return pathname === url;
}

/**
 * Whether a folder contains the current page, at any depth.
 *
 * @param node - Folder node
 * @param pathname - Current pathname
 */
function containsPathname(node: PageTree.Folder, pathname: string): boolean {
  if (node.index && isUrlActive(node.index.url, pathname)) return true;
  return node.children.some((child) => {
    if (child.type === "page") return isUrlActive(child.url, pathname);
    if (child.type === "folder") return containsPathname(child, pathname);
    return false;
  });
}

/**
 * Which accordion group should be open for a pathname: the one holding the
 * current page, else the first group.
 *
 * @param folders - Root-level folders with their keys
 * @param pathname - Current pathname
 */
function defaultOpenKey(
  folders: ReadonlyArray<{ key: string; node: PageTree.Folder }>,
  pathname: string,
): string | null {
  const match = folders.find((entry) => containsPathname(entry.node, pathname));
  return match?.key ?? folders[0]?.key ?? null;
}

/** A leaf row in the tree. */
function TreeLink({
  href,
  active,
  icon,
  depth,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  depth: 0 | 1;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-active={active || undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
        depth === 1 && "pl-5 text-[12.5px]",
        active
          ? "bg-fd-foreground/8 font-medium text-fd-foreground"
          : "text-fd-muted-foreground hover:bg-fd-foreground/4 hover:text-fd-foreground",
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center transition-opacity [&>svg]:size-[14px]",
            active
              ? "text-fd-foreground opacity-100"
              : "text-fd-muted-foreground/70 group-hover:opacity-100",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 grow truncate">{children}</span>
    </Link>
  );
}

/** Named separator inside the tree — a small label with a hairline rail. */
function TreeSeparator({ name }: { name?: ReactNode }) {
  if (!name) return <div className="mx-2 my-2.5 h-px bg-fd-foreground/5" />;
  return (
    <div className="mx-2 mt-4 mb-1.5 flex flex-row items-center gap-2 first:mt-1">
      <p className="font-mono text-[10px] font-medium tracking-[0.16em] text-fd-muted-foreground/75 uppercase select-none">
        {name}
      </p>
      <div className="h-px grow bg-fd-foreground/8" />
    </div>
  );
}

/**
 * Whether a page is this folder's landing (`…/section/index.mdx` → `/docs/section`).
 *
 * @param folder - Accordion folder
 * @param pageUrl - Candidate page URL
 */
function isFolderLandingPage(folder: PageTree.Folder, pageUrl: string): boolean {
  if (folder.index?.url === pageUrl) return true;
  const siblings = folder.children.filter(
    (child): child is PageTree.Item => child.type === "page" && child.url !== pageUrl,
  );
  return siblings.length > 0 && siblings.every((child) => child.url.startsWith(`${pageUrl}/`));
}

/**
 * Resolves the display label for a page in the sidebar.
 * Landing pages (`index.mdx` / folder root / matching folder name) are labeled "Overview".
 *
 * @param child - Page tree item
 * @param folder - Parent folder
 */
function pageDisplayName(child: PageTree.Item, folder?: PageTree.Folder): ReactNode {
  if (child.name === "Index") return "Overview";
  if (folder) {
    if (folder.index?.url === child.url) return "Overview";
    if (folder.name === child.name) return "Overview";
    if (isFolderLandingPage(folder, child.url)) return "Overview";
  }
  if (
    child.$id?.endsWith("index.mdx") ||
    (typeof child.$ref === "string" && child.$ref.endsWith("index.mdx"))
  ) {
    return "Overview";
  }
  return child.name;
}

/** Children of one accordion group. */
function GroupBody({
  node,
  pathname,
  onNavigate,
}: {
  node: PageTree.Folder;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="relative ml-3.5 my-0.5 flex flex-col gap-0.5 border-l border-fd-foreground/8 pl-2 py-0.5">
      {node.children.map((child, index) => {
        if (child.type === "separator") {
          return <TreeSeparator key={`sep-${index}`} name={child.name} />;
        }
        if (child.type === "page") {
          return (
            <TreeLink
              key={child.url}
              href={child.url}
              active={isUrlActive(child.url, pathname)}
              icon={child.icon}
              depth={0}
              onNavigate={onNavigate}
            >
              {pageDisplayName(child, node)}
            </TreeLink>
          );
        }
        // Nested folder: flatten one level rather than nest a second accordion.
        return (
          <div key={`nested-${index}`} className="flex flex-col gap-0.5">
            <TreeSeparator name={child.name} />
            {child.children.map((leaf) =>
              leaf.type === "page" ? (
                <TreeLink
                  key={leaf.url}
                  href={leaf.url}
                  active={isUrlActive(leaf.url, pathname)}
                  icon={leaf.icon}
                  depth={1}
                  onNavigate={onNavigate}
                >
                  {pageDisplayName(leaf, child)}
                </TreeLink>
              ) : null,
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Unwraps intermediate grouping folders:
 * - `Concepts`: renders flat as top-level links directly under `01 CONCEPTS`.
 * - `Elements`: each element (`Flow`, `Signal`, `Store`, etc.) becomes an accordion
 *   under `02 ELEMENTS`, omitting the redundant /docs/elements landing page.
 */
function normalizeSidebarTree(tree: PageTree.Root): PageTree.Root {
  const children: PageTree.Node[] = [];

  for (const node of tree.children) {
    if (isFolder(node) && (node.name === "Concepts" || node.$id === "concepts")) {
      for (const child of node.children) {
        children.push(child);
      }
    } else if (isFolder(node) && (node.name === "Elements" || node.$id === "elements")) {
      for (const child of node.children) {
        // Skip the /docs/elements landing page in the sidebar list
        if (child.type === "page") continue;
        children.push(child);
      }
    } else {
      children.push(node);
    }
  }

  return { ...tree, children };
}

/**
 * The page-tree navigation: root pages render flat, folders as a single-open
 * accordion. Shared by the desktop sidebar and the mobile overlay.
 *
 * @param tree - Fumadocs page tree root
 * @param onNavigate - Called after any link click (closes the mobile overlay)
 */
export function DocsTreeNav({
  tree: rawTree,
  onNavigate,
}: {
  tree: PageTree.Root;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const tree = useMemo(() => normalizeSidebarTree(rawTree), [rawTree]);
  const folders = useMemo(
    () =>
      tree.children
        .map((node, index) => ({ node, index }))
        .filter((entry): entry is { node: PageTree.Folder; index: number } => isFolder(entry.node))
        .map((entry) => ({ key: folderKey(entry.node, entry.index), node: entry.node })),
    [tree],
  );

  /*
   * The URL decides which group is open; a click overrides that until the next
   * navigation. Tagging the override with the pathname it was made on is what
   * expires it, so no effect has to reconcile the two.
   */
  const [override, setOverride] = useState<{
    pathname: string;
    key: string | null;
  } | null>(null);
  const openKey =
    override?.pathname === pathname ? override.key : defaultOpenKey(folders, pathname);

  return (
    <div className="flex flex-col gap-0.5">
      {tree.children.map((node, index) => {
        if (node.type === "separator") {
          return <TreeSeparator key={`root-sep-${index}`} name={node.name} />;
        }

        // Root index (`/docs`) is the docs landing — the header tab already
        // reaches it, so listing it again in this pane is noise.
        if (node.type === "page") {
          if (node.url === "/docs") return null;
          return (
            <TreeLink
              key={node.url}
              href={node.url}
              active={isUrlActive(node.url, pathname)}
              icon={node.icon}
              depth={0}
              onNavigate={onNavigate}
            >
              {node.name}
            </TreeLink>
          );
        }

        const key = folderKey(node, index);
        const open = openKey === key;
        return (
          <div key={key} className="flex flex-col">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOverride({ pathname, key: open ? null : key })}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors",
                open
                  ? "text-fd-foreground font-semibold"
                  : "text-fd-muted-foreground hover:bg-fd-foreground/4 hover:text-fd-foreground",
              )}
            >
              {node.icon ? (
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center transition-opacity [&>svg]:size-[15px]",
                    open
                      ? "text-fd-foreground opacity-100"
                      : "text-fd-muted-foreground/75 group-hover:opacity-100",
                  )}
                >
                  {node.icon}
                </span>
              ) : null}
              <span className="grow truncate">{node.name}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-fd-muted-foreground/60 transition-transform duration-200 group-hover:text-fd-foreground/80",
                  open && "rotate-180 text-fd-foreground/80",
                )}
                aria-hidden
              />
            </button>
            {open ? <GroupBody node={node} pathname={pathname} onNavigate={onNavigate} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Version row — reads the published version and links to the changelog. */
function VersionRow() {
  return (
    <Link
      href="/changelog"
      className="group/version flex w-full items-center gap-2 border-b border-fd-foreground/5 px-3.5 py-2 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-foreground/3 hover:text-fd-foreground/80"
    >
      <GitBranch
        className="size-3.5 shrink-0 opacity-55 transition-opacity group-hover/version:opacity-80"
        aria-hidden
      />
      <span className="font-mono text-xs">v{OKE_VERSION}</span>
      <span className="border border-dashed border-fd-foreground/20 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-fd-muted-foreground uppercase">
        latest
      </span>
    </Link>
  );
}

/** Search row — opens the Fumadocs search dialog. */
function SearchRow() {
  const { setOpenSearch } = useSearchContext();
  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      className="group/search flex w-full items-center gap-2 border-b border-fd-foreground/5 px-3.5 py-2 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-foreground/3 hover:text-fd-foreground/80"
    >
      <Search
        className="size-3.5 shrink-0 opacity-55 transition-opacity group-hover/search:opacity-80"
        aria-hidden
      />
      <span className="truncate text-xs">Search</span>
      <kbd className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded border border-fd-foreground/10 px-1.5 py-0.5 font-mono text-[10px] text-fd-muted-foreground">
        <span className="text-[11px]">&#8984;</span>K
      </kbd>
    </button>
  );
}

/**
 * Fixed docs sidebar: version, search, page tree, then repo + theme.
 *
 * @param tree - Fumadocs page tree root
 */
export function DocsSidebar({ tree }: { tree: PageTree.Root }) {
  return (
    <aside className="fixed top-(--landing-topbar-height) bottom-0 left-0 z-30 hidden w-(--landing-left-pane-width) flex-col border-r border-fd-foreground/5 bg-fd-background lg:flex">
      <VersionRow />
      <SearchRow />
      <nav className="oke-sidebar-scroll flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-2">
        <DocsTreeNav tree={tree} />
      </nav>
      <div className="flex items-center gap-1 border-t border-fd-foreground/5 p-2 text-fd-muted-foreground">
        <a
          href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub repository"
          className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-fd-foreground/5 hover:text-fd-foreground"
        >
          <GithubMark className="size-4" />
        </a>
        <ThemeSwitch className="ms-auto border-fd-foreground/10" mode="light-dark" />
      </div>
    </aside>
  );
}
