/**
 * Header tab strip. Structure adapted from better-auth/better-auth
 * `docs/components/landing/staggered-nav-files.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida. See site/NOTICE.
 *
 * The bar is one row, `--landing-topbar-height` tall, split into a brand cell and
 * an equal-width tab strip. It is sticky rather than fixed, and mounted once in
 * the root layout: the brand cell's width is a share of the surface below it and
 * therefore changes per route, so the bar has to survive navigation to animate
 * between those widths instead of snapping.
 */

"use client";

import { animate, AnimatePresence, motion, MotionConfig, useMotionValue } from "framer-motion";
import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import type * as PageTree from "fumadocs-core/page-tree";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DocsTreeNav } from "@/components/chrome/docs-sidebar";
import { ExternalArrow, GithubMark } from "@/components/chrome/icons";
import { OkeLogo } from "@/components/oke-logo";
import { cn } from "@/lib/cn";
import { hasDocsPane, headerGeometry, isNavTabActive, NAV_TABS } from "@/lib/nav";
import { gitConfig } from "@/lib/shared";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const REPO_URL = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

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
 * Sticky site header. Mount once, in the root layout.
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
      <header className="sticky top-0 z-[99] bg-fd-background">
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
          <div className="hidden min-w-0 flex-1 items-stretch lg:flex">
            {NAV_TABS.map((tab) => {
              const active = isNavTabActive(tab, pathname);
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
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
                  {/* Shared element: slides from the previous tab to this one. */}
                  {active ? (
                    reduced ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-0 -bottom-px h-0.5 bg-fd-foreground/50"
                      />
                    ) : (
                      <motion.span
                        layoutId="oke-active-tab"
                        aria-hidden
                        className="absolute inset-x-0 -bottom-px h-0.5 bg-fd-foreground/50"
                      />
                    )
                  ) : null}
                </Link>
              );
            })}

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
    </MotionConfig>
  );
}
