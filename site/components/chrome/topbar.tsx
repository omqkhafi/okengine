/**
 * Header tab strip. Structure adapted from better-auth/better-auth
 * `docs/components/landing/staggered-nav-files.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida. See site/NOTICE.
 *
 * The bar is one row, `--landing-topbar-height` tall, split into a brand cell and
 * an equal-width tab strip. It is fixed to the viewport (not sticky), and mounted
 * once in the root layout: the brand cell's width is a share of the surface below
 * it and therefore changes per route, so the bar has to survive navigation to
 * animate between those widths instead of snapping. A matching-height spacer
 * keeps page content from sliding under the bar.
 */

"use client";

import {
  animate,
  AnimatePresence,
  motion,
  MotionConfig,
  useMotionValue,
  useMotionValueEvent,
  type MotionValue,
} from "framer-motion";
import { Menu, Moon, Search, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "@fumadocs/base-ui/contexts/search";
import { ThemeSwitch } from "@fumadocs/base-ui/layouts/shared/slots/theme-switch";
import { useTheme } from "@fumadocs/base-ui/provider/base";
import type * as PageTree from "fumadocs-core/page-tree";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DocsTreeNav } from "@/components/chrome/docs-sidebar";
import { ExternalArrow, GithubMark, NpmMark } from "@/components/chrome/icons";
import { OkeLogo } from "@/components/oke-logo";
import { cn } from "@/lib/cn";
import { hasDocsPane, headerGeometry, isNavTabActive, NAV_TABS } from "@/lib/nav";
import { githubRepoUrl, npmPackageUrl } from "@/lib/shared";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const REPO_URL = githubRepoUrl;

/** Flush 1:1 header cells — height is `--landing-topbar-height`. */
const SQUARE_CELL = "flex aspect-square h-full shrink-0 items-center justify-center";

/** One easing for every header transition, so the parts move as one object. */
const EASE = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

/** Measuring must beat paint, but a layout effect has nothing to do server-side. */
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Tracks the brand cell's target width in pixels.
 *
 * The three widths are a mix of percentages and a token, which do not interpolate
 * against each other as CSS values — so a hidden sizer carries the route's real
 * CSS width and reports the pixel result. Animating the measured width (rather
 * than a transform) means the tab strip's `flex-1` follows every frame and no
 * hairline or label is ever scaled.
 *
 * @param paneWidth - CSS width for the current route
 * @returns Ref for the sizer element, and the motion value to render
 */
function usePaneWidth(paneWidth: string, reduced: boolean) {
  const sizerRef = useRef<HTMLDivElement | null>(null);
  // Seeded with the CSS value so server-rendered HTML is already the right width.
  const width = useMotionValue<string | number>(paneWidth);
  const target = useRef<number | null>(null);
  const previous = useRef<string | null>(null);

  useMeasureEffect(() => {
    const sizer = sizerRef.current;
    if (!sizer) return;

    const sync = (animated: boolean) => {
      const px = sizer.getBoundingClientRect().width;
      // Zero below the `lg` breakpoint, where the cell is display:none.
      if (px <= 0 || px === target.current) return;
      target.current = px;
      if (animated && !reduced) void animate(width, px, EASE);
      else width.jump(px);
    };

    sync(previous.current !== null && previous.current !== paneWidth);
    previous.current = paneWidth;

    // Fires once on observe; `sync` no-ops because the width already matches.
    const observer = new ResizeObserver(() => sync(false));
    observer.observe(sizer);
    return () => observer.disconnect();
  }, [paneWidth, reduced, width]);

  return { sizerRef, width };
}

/**
 * Active-tab underline pinned to the strip's bottom edge.
 *
 * A shared `layoutId` morph fights the brand-cell width spring and leaves the
 * hairline floating on the Y axis. One measured bar that only animates `x` /
 * `width` stays flush with the border through every route change.
 *
 * @param activeId - Current tab id, or null when none match
 * @param paneWidthMv - Brand-cell width motion value; each frame remeasures tabs
 * @param reduced - Skip the slide when the user prefers reduced motion
 */
function useActiveTabIndicator(
  activeId: string | null,
  paneWidthMv: MotionValue<string | number>,
  reduced: boolean,
) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const x = useMotionValue(0);
  const width = useMotionValue(0);
  const ready = useRef(false);

  const measure = (animated: boolean) => {
    const strip = stripRef.current;
    const tab = activeId ? tabRefs.current.get(activeId) : undefined;
    if (!strip || !tab) return;

    const stripRect = strip.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const nextX = tabRect.left - stripRect.left;
    const nextW = tabRect.width;
    if (nextW <= 0) return;

    const slide = animated && ready.current && !reduced;
    if (slide) {
      void animate(x, nextX, EASE);
      void animate(width, nextW, EASE);
    } else {
      x.jump(nextX);
      width.jump(nextW);
      ready.current = true;
    }
  };

  useMeasureEffect(() => {
    measure(true);
    const strip = stripRef.current;
    if (!strip) return;
    // Catches viewport / font-driven tab resizes the pane spring does not.
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(strip);
    return () => observer.disconnect();
  }, [activeId, reduced]);

  // Brand width spring reshapes the flex strip every frame — follow it.
  useMotionValueEvent(paneWidthMv, "change", () => measure(false));

  return { stripRef, tabRefs, x, width };
}

/**
 * Square light/dark toggle. Reads the live `dark` class — `resolvedTheme` is
 * unset until next-themes hydrates, and `startViewTransition` can exist in
 * embedded previews without ever running its update callback.
 */
function HeaderThemeButton() {
  const { setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
        setTheme(next);
      }}
      className={cn(
        SQUARE_CELL,
        "text-fd-muted-foreground transition-colors duration-150 hover:bg-fd-foreground/[0.03] hover:text-fd-foreground",
      )}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </button>
  );
}

/**
 * Fixed site header. Mount once, in the root layout.
 *
 * @param tree - Docs page tree, for the mobile overlay's docs navigation
 */
export function Topbar({ tree }: { tree: PageTree.Root }) {
  const pathname = usePathname();
  const { setOpenSearch } = useSearchContext();
  const isDocs = hasDocsPane(pathname);
  const { paneWidth, rule } = headerGeometry(pathname);
  const reduced = useClientReducedMotion();
  const { sizerRef, width } = usePaneWidth(paneWidth, reduced);
  const activeTabId = NAV_TABS.find((tab) => isNavTabActive(tab, pathname))?.id ?? null;
  const {
    stripRef,
    tabRefs,
    x: indicatorX,
    width: indicatorWidth,
  } = useActiveTabIndicator(activeTabId, width, reduced);

  /*
   * The overlay is tied to the pathname it was opened on, so navigating away
   * closes it without an effect. Links still clear it explicitly, for the case
   * where the target is the page you are already on.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuOpen = openedAt === pathname;
  const closeMenu = () => setOpenedAt(null);

  return (
    <MotionConfig reducedMotion="never" transition={EASE}>
      <header className="fixed inset-x-0 top-0 z-[99] bg-fd-background">
        <div
          className={cn("relative flex h-(--landing-topbar-height) items-stretch border-b", rule)}
        >
          {/* Measures the route's real CSS width; never painted. */}
          <div
            ref={sizerRef}
            aria-hidden
            className="pointer-events-none invisible absolute top-0 left-0 hidden h-0 lg:block"
            style={{ width: paneWidth }}
          />

          {/* Brand cell — ends where the first rule of the surface below begins. */}
          <motion.div
            style={{ width }}
            className={cn("relative hidden shrink-0 items-stretch border-e lg:flex", rule)}
          >
            <Link
              href="/"
              className="flex h-full items-center px-4 text-fd-foreground transition-opacity hover:opacity-80"
            >
              <OkeLogo className="h-4 w-auto" />
            </Link>
          </motion.div>

          {/* Mobile bar. */}
          <div className="flex w-full items-center gap-1 px-3 lg:hidden">
            <Link href="/" className="mr-auto flex items-center text-fd-foreground">
              <OkeLogo className="h-4 w-auto" />
            </Link>
            <button
              type="button"
              aria-label="Search"
              onClick={() => setOpenSearch(true)}
              className="inline-flex size-8 items-center justify-center text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              <Search className="size-4" aria-hidden />
            </button>
            <ThemeSwitch className="border-fd-border" mode="light-dark" />
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setOpenedAt(menuOpen ? null : pathname)}
              className="inline-flex size-8 items-center justify-center text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              {menuOpen ? (
                <X className="size-4" aria-hidden />
              ) : (
                <Menu className="size-4" aria-hidden />
              )}
            </button>
          </div>

          {/* Desktop tab strip. */}
          <div ref={stripRef} className="relative hidden min-w-0 flex-1 items-stretch lg:flex">
            {NAV_TABS.map((tab) => {
              const active = isNavTabActive(tab, pathname);
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  ref={(node) => {
                    if (node) tabRefs.current.set(tab.id, node);
                    else tabRefs.current.delete(tab.id);
                  }}
                  className={cn(
                    "group/tab relative flex flex-1 items-center justify-center border-e px-2 transition-colors duration-150 xl:px-4",
                    rule,
                    active ? undefined : "hover:bg-fd-foreground/[0.03]",
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-xs tracking-wider whitespace-nowrap uppercase transition-colors duration-150",
                      active
                        ? "text-fd-foreground"
                        : "text-fd-muted-foreground group-hover/tab:text-fd-foreground/75",
                    )}
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}

            {activeTabId ? (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute left-0 -bottom-px h-0.5 bg-fd-foreground/50"
                style={{ x: indicatorX, width: indicatorWidth }}
              />
            ) : null}

            <HeaderThemeButton />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="flex shrink-0 cursor-pointer items-center gap-1.5 bg-fd-foreground px-5 text-fd-background transition-opacity duration-150 hover:opacity-90"
            >
              <GithubMark className="size-3.5 opacity-70" />
              <span className="font-mono text-xs tracking-wider uppercase">github</span>
              <ExternalArrow className="size-2.5 opacity-50" />
            </a>
            <a
              href={npmPackageUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="okengine on npm"
              className={cn(SQUARE_CELL, "transition-opacity duration-150 hover:opacity-90")}
            >
              <NpmMark className="size-full" />
            </a>
          </div>
        </div>

        {/* Mobile overlay. */}
        <AnimatePresence>
          {menuOpen ? (
            <motion.div
              key="menu"
              initial={reduced ? false : { opacity: 0, y: -8 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              className="fixed inset-x-0 top-(--landing-topbar-height) bottom-0 z-[98] overflow-y-auto bg-fd-background/95 backdrop-blur-sm lg:hidden"
            >
              <nav className="flex flex-col border-b border-fd-border">
                {NAV_TABS.map((tab) => (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    onClick={closeMenu}
                    className={cn(
                      "border-b border-fd-border px-4 py-3 font-mono text-xs tracking-wider uppercase transition-colors",
                      isNavTabActive(tab, pathname)
                        ? "bg-fd-foreground/5 text-fd-foreground"
                        : "text-fd-muted-foreground hover:text-fd-foreground",
                    )}
                  >
                    {tab.label}
                  </Link>
                ))}
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 px-4 py-3 font-mono text-xs tracking-wider text-fd-muted-foreground uppercase transition-colors hover:text-fd-foreground"
                >
                  <GithubMark className="size-3.5" />
                  github
                  <ExternalArrow className="size-2.5 opacity-50" />
                </a>
                <a
                  href={npmPackageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 px-4 py-3 font-mono text-xs tracking-wider text-fd-muted-foreground uppercase transition-colors hover:text-fd-foreground"
                >
                  <NpmMark className="size-3.5" />
                  npm
                  <ExternalArrow className="size-2.5 opacity-50" />
                </a>
              </nav>

              {isDocs ? (
                <div className="pb-16">
                  <DocsTreeNav tree={tree} onNavigate={closeMenu} />
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>
      {/* Reserves the bar's height in document flow — fixed removes it from layout. */}
      <div aria-hidden className="h-(--landing-topbar-height) shrink-0" />
    </MotionConfig>
  );
}
