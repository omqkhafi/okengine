/**
 * Docs sidebar — a fixed pane rendered as a sibling of Fumadocs' `DocsLayout`
 * (whose own sidebar is disabled). Structure adapted from better-auth/better-auth
 * `docs/components/docs/docs-sidebar.tsx` under the MIT License. Copyright (c)
 * 2024 - present, Bereket Engida. See site/NOTICE.
 *
 * The nav is driven by the Fumadocs page tree, not a hand-written list, so
 * `meta.json` stays the single source of navigation truth.
 */

'use client';

import { ChevronDown, GitBranch, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import type * as PageTree from 'fumadocs-core/page-tree';
import { useMemo, useState, type ReactNode } from 'react';
import { GithubMark } from '@/components/chrome/icons';
import { cn } from '@/lib/cn';
import { OKE_VERSION } from '@/lib/elements';
import { gitConfig } from '@/lib/shared';

/** Folders are the accordion groups; everything else renders flat. */
function isFolder(node: PageTree.Node): node is PageTree.Folder {
  return node.type === 'folder';
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
    if (child.type === 'page') return isUrlActive(child.url, pathname);
    if (child.type === 'folder') return containsPathname(child, pathname);
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
        'relative flex w-full items-center gap-2.5 py-1 pr-4 text-[14px] transition-colors duration-150',
        depth === 0 ? 'pl-4' : 'pl-10 text-[13px]',
        active
          ? 'bg-fd-foreground/6 text-fd-foreground'
          : 'text-fd-muted-foreground hover:bg-fd-foreground/3 hover:text-fd-foreground/90',
      )}
    >
      {icon ? (
        <span className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-[14px]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 grow truncate">{children}</span>
    </Link>
  );
}

/** Named separator inside the tree — a small label with a hairline rail. */
function TreeSeparator({ name }: { name?: ReactNode }) {
  if (!name) return <div className="mx-4 my-2 h-px bg-fd-border" />;
  return (
    <div className="mx-4 my-2 flex flex-row items-center gap-2">
      <p className="font-mono text-[10px] tracking-[0.16em] text-fd-muted-foreground uppercase">
        {name}
      </p>
      <div className="h-px grow bg-fd-border" />
    </div>
  );
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
    <div className="py-1 text-sm">
      {node.index ? (
        <TreeLink
          href={node.index.url}
          active={isUrlActive(node.index.url, pathname)}
          icon={node.index.icon}
          depth={0}
          onNavigate={onNavigate}
        >
          {node.index.name}
        </TreeLink>
      ) : null}
      {node.children.map((child, index) => {
        if (child.type === 'separator') {
          return <TreeSeparator key={`sep-${index}`} name={child.name} />;
        }
        if (child.type === 'page') {
          return (
            <TreeLink
              key={child.url}
              href={child.url}
              active={isUrlActive(child.url, pathname)}
              icon={child.icon}
              depth={0}
              onNavigate={onNavigate}
            >
              {child.name}
            </TreeLink>
          );
        }
        // Nested folder: flatten one level rather than nest a second accordion.
        return (
          <div key={`nested-${index}`}>
            <TreeSeparator name={child.name} />
            {child.children.map((leaf) =>
              leaf.type === 'page' ? (
                <TreeLink
                  key={leaf.url}
                  href={leaf.url}
                  active={isUrlActive(leaf.url, pathname)}
                  icon={leaf.icon}
                  depth={1}
                  onNavigate={onNavigate}
                >
                  {leaf.name}
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
 * The page-tree navigation: root pages render flat, folders as a single-open
 * accordion. Shared by the desktop sidebar and the mobile overlay.
 *
 * @param tree - Fumadocs page tree root
 * @param onNavigate - Called after any link click (closes the mobile overlay)
 */
export function DocsTreeNav({
  tree,
  onNavigate,
}: {
  tree: PageTree.Root;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const folders = useMemo(
    () =>
      tree.children
        .map((node, index) => ({ node, index }))
        .filter((entry): entry is { node: PageTree.Folder; index: number } =>
          isFolder(entry.node),
        )
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
    <>
      {tree.children.map((node, index) => {
        if (node.type === 'separator') {
          return <TreeSeparator key={`root-sep-${index}`} name={node.name} />;
        }

        // Root index (`/docs`) is the docs landing — the header tab already
        // reaches it, so listing it again in this pane is noise.
        if (node.type === 'page') {
          if (node.url === '/docs') return null;
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
          <div key={key}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOverride({ pathname, key: open ? null : key })}
              className={cn(
                'flex w-full items-center gap-2 border-b border-fd-foreground/6 px-4 py-2.5 text-left text-sm font-medium transition-colors',
                open
                  ? 'bg-fd-foreground/3 text-fd-foreground'
                  : 'text-fd-muted-foreground hover:bg-fd-foreground/3 hover:text-fd-foreground',
              )}
            >
              {node.icon ? (
                <span className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-[16px]">
                  {node.icon}
                </span>
              ) : null}
              <span className="grow truncate">{node.name}</span>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-fd-muted-foreground transition-transform duration-200',
                  open && 'rotate-180',
                )}
                aria-hidden
              />
            </button>
            {open ? <GroupBody node={node} pathname={pathname} onNavigate={onNavigate} /> : null}
          </div>
        );
      })}
    </>
  );
}

/** Version row — reads the published version and links to the changelog. */
function VersionRow() {
  return (
    <Link
      href="/changelog"
      className="group/version flex w-full items-center gap-2 border-b border-fd-foreground/5 px-4 py-[9px] text-sm text-fd-muted-foreground transition-colors hover:bg-fd-foreground/3 hover:text-fd-foreground/80"
    >
      <GitBranch
        className="size-4 shrink-0 opacity-55 transition-opacity group-hover/version:opacity-80"
        aria-hidden
      />
      <span className="truncate">v{OKE_VERSION}</span>
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
      className="group/search flex w-full items-center gap-2 border-b border-fd-foreground/5 px-4 py-[9px] text-sm text-fd-muted-foreground transition-colors hover:bg-fd-foreground/3 hover:text-fd-foreground/80"
    >
      <Search
        className="size-4 shrink-0 opacity-55 transition-opacity group-hover/search:opacity-80"
        aria-hidden
      />
      <span className="truncate">Search</span>
      <kbd className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md border border-fd-foreground/10 px-1.5 py-0.5 font-mono text-[10px] text-fd-muted-foreground">
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
      <nav
        className="oke-sidebar-scroll flex-1 overflow-x-hidden overflow-y-auto pb-3"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, white 1rem, white calc(100% - 2rem), transparent 100%)',
        }}
      >
        <DocsTreeNav tree={tree} />
      </nav>
      <div className="flex items-center gap-1 border-t border-fd-foreground/5 p-2 text-fd-muted-foreground">
        <a
          href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub repository"
          className="inline-flex size-8 items-center justify-center transition-colors hover:bg-fd-foreground/5 hover:text-fd-foreground"
        >
          <GithubMark className="size-4" />
        </a>
        <ThemeSwitch className="ms-auto border-fd-foreground/10" mode="light-dark" />
      </div>
    </aside>
  );
}
