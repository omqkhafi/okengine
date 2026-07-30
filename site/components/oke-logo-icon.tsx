"use client";

import { useEffect, useState, type SVGProps } from "react";

import { cn } from "@/lib/cn";

export type OkeLogoLetter = "O" | "K" | "E";

export const OKE_LOGO_LETTERS: Record<OkeLogoLetter, { width: number; height: number; d: string }> =
  {
    O: {
      width: 95,
      height: 85,
      d: "M75.865 84.191C73.608 84.512 71.12 84.672 68.4 84.672H26.352C19.632 84.672 14.352 83.712 10.512 81.792C6.672 79.872 3.936 76.992 2.304 73.152C0.768001 69.312 0 64.56 0 58.896V25.632C0 20.064 0.768001 15.408 2.304 11.664C3.84 7.824 6.528 4.944 10.368 3.024C14.208 1.008 19.536 0 26.352 0H68.4C71.135 0 73.623 0.166992 75.865 0.500992V13.672H92.928C94.048 17.033 94.608 21.019 94.608 25.632V58.896C94.608 63.392 94.078 67.318 93.017 70.672H75.865V84.191ZM30.528 70.848H64.368C67.92 70.848 70.656 69.936 72.576 68.112C74.592 66.288 75.6 63.792 75.6 60.624V23.904C75.6 21.12 74.592 18.768 72.576 16.848C70.56 14.832 67.824 13.824 64.368 13.824H30.528C27.072 13.824 24.288 14.736 22.176 16.56C20.064 18.384 19.008 20.832 19.008 23.904V60.624C19.008 63.888 20.016 66.432 22.032 68.256C24.144 69.984 26.976 70.848 30.528 70.848Z",
    },
    K: {
      width: 101,
      height: 87,
      d: "M19.008 13.672V36.864H27.072C28.992 36.864 30.576 36.624 31.824 36.144C33.072 35.664 34.224 34.896 35.28 33.84C37.968 31.152 41.04 27.792 44.496 23.76C47.952 19.728 51.312 15.6 54.576 11.376C57.936 7.05599 60.816 3.264 63.216 0H86.544L80.64 8.64C77.952 11.424 75.072 14.448 72 17.712C68.928 20.976 65.904 24.192 62.928 27.36C59.952 30.432 57.264 33.168 54.864 35.568C52.464 37.872 50.688 39.552 49.536 40.608C52.128 41.472 54.48 42.576 56.592 43.92C58.8 45.264 61.488 47.232 64.656 49.824C67.056 51.744 69.36 53.712 71.568 55.728C73.872 57.744 76.512 60.144 79.488 62.928C82.848 66 86.016 68.256 88.992 69.696C91.968 71.136 94.464 72.048 96.48 72.432C98.592 72.816 99.936 73.008 100.512 73.008L97.632 84.672C97.344 84.96 96.48 85.248 95.04 85.536C93.6 85.92 91.536 86.112 88.848 86.112C84.144 86.112 80.064 85.152 76.608 83.232C73.152 81.312 69.744 78.72 66.384 75.456C62.736 71.616 58.32 67.2 53.136 62.208C50.736 59.712 48.288 57.648 45.792 56.016C43.296 54.384 40.464 53.136 37.296 52.272C34.224 51.408 30.384 50.976 25.776 50.976H19.008V70.672H0V13.672H19.008Z",
    },
    E: {
      width: 96,
      height: 85,
      d: "M0 84.672V0H89.568V13.824H19.008V33.696H72.864V47.952H19.008V70.848H90.144L95.904 83.088C95.904 83.472 94.608 83.856 92.016 84.24C89.424 84.528 84.96 84.672 78.624 84.672H0Z",
    },
  };

const CYCLE: OkeLogoLetter[] = ["O", "K", "E"];
const CANVAS = 96;
const PAD = 14;
const CONTENT = CANVAS - PAD * 2;
const MAX_W = 101;
const MAX_H = 87;
const SCALE = Math.min(CONTENT / MAX_W, CONTENT / MAX_H);
/** Soft blur morph duration (ms). */
const FADE_MS = 560;
const FAVICON_FADE_STEPS = 10;
const MAX_BLUR = 7;
const MIN_SCALE = 0.92;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Bell curve: 0 at ends, 1 at midpoint. */
function peak(t: number): number {
  return Math.sin(Math.PI * t);
}

function letterTransform(letter: OkeLogoLetter, scaleMul = 1): string {
  const { width, height } = OKE_LOGO_LETTERS[letter];
  const s = SCALE * scaleMul;
  const w = width * s;
  const h = height * s;
  const x = (CANVAS - w) / 2;
  const y = (CANVAS - h) / 2;
  return `translate(${x} ${y}) scale(${s})`;
}

function letterGroup(
  letter: OkeLogoLetter,
  opacity: number,
  scaleMul = 1,
  filter?: string,
): string {
  const { d } = OKE_LOGO_LETTERS[letter];
  const filterAttr = filter ? ` filter="${filter}"` : "";
  return `<g opacity="${opacity.toFixed(3)}"${filterAttr} transform="${letterTransform(letter, scaleMul)}"><path d="${d}" fill="#FFFFFF"/></g>`;
}

function markShell(inner: string, blur = 0): string {
  const filter =
    blur > 0.05
      ? `<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" fill="none"><defs><clipPath id="c"><rect width="${CANVAS}" height="${CANVAS}" rx="20"/></clipPath>${filter}</defs><rect width="${CANVAS}" height="${CANVAS}" rx="20" fill="#0D0D0D"/><g clip-path="url(#c)">${inner}</g></svg>`;
}

/** SVG mark markup for a single letter (favicon / data-URL). */
export function okeLogoMarkSvg(letter: OkeLogoLetter, opacity = 1): string {
  return markShell(letterGroup(letter, opacity));
}

/**
 * Soft morph frame between two letters.
 * `t` is 0 (from) → 1 (to): crossfade + mid-peak blur + slight scale pulse.
 */
export function okeLogoMarkCrossfadeSvg(from: OkeLogoLetter, to: OkeLogoLetter, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const e = easeInOutCubic(clamped);
  const p = peak(clamped);
  const blur = MAX_BLUR * p;
  const scaleMul = 1 - (1 - MIN_SCALE) * p;
  const filter = blur > 0.05 ? "url(#b)" : undefined;

  return markShell(
    `${letterGroup(from, 1 - e, scaleMul, filter)}${letterGroup(to, e, scaleMul, filter)}`,
    blur,
  );
}

export type OkeLogoIconProps = SVGProps<SVGSVGElement> & {
  /** Which letter to show. Ignored when `animated` is true. */
  letter?: OkeLogoLetter;
  /** Cycle O → K → E with a blurred morph. */
  animated?: boolean;
  /** Hold time per letter in ms. Default 1500. */
  intervalMs?: number;
};

/**
 * OKE logo mark — single letter in the rounded brand square.
 *
 * Paths from `site/public/logo/OKE-B-{O,K,E}.svg`. White letter on `#0D0D0D`.
 */
export function OkeLogoIcon({
  letter = "O",
  animated = false,
  intervalMs = 1500,
  className,
  ...props
}: OkeLogoIconProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!animated) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % CYCLE.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [animated, intervalMs]);

  const active = animated ? CYCLE[index]! : letter;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${CANVAS} ${CANVAS}`}
      fill="none"
      role="img"
      aria-label="OKE"
      className={cn("size-8 overflow-hidden rounded-[20.8%]", className)}
      {...props}
    >
      <rect width={CANVAS} height={CANVAS} rx="20" fill="#0D0D0D" />
      {(animated ? CYCLE : [active]).map((L) => {
        const { d } = OKE_LOGO_LETTERS[L];
        const on = L === active;
        return (
          <g
            key={L}
            transform={letterTransform(L)}
            style={{
              opacity: on ? 1 : 0,
              filter: on ? "blur(0px)" : `blur(${MAX_BLUR}px)`,
              transition: [
                `opacity ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                `filter ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
              ].join(", "),
            }}
          >
            <path d={d} fill="#FFFFFF" />
          </g>
        );
      })}
    </svg>
  );
}

function setFaviconHref(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[data-oke-favicon-cycle]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.dataset.okeFaviconCycle = "";
    document.head.appendChild(link);
  }
  link.href = href;
}

/**
 * Cycles the document favicon through O → K → E every `intervalMs`,
 * with a blurred soft-morph between letters.
 *
 * Mount once in the root layout.
 */
export function OkeFaviconCycle({ intervalMs = 1500 }: { intervalMs?: number }) {
  useEffect(() => {
    let i = 0;
    let cancelled = false;
    let objectUrl: string | null = null;
    const timers: number[] = [];

    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };

    const paint = (svg: string) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setFaviconHref(objectUrl);
    };

    const holdMs = Math.max(intervalMs - FADE_MS, 200);

    const runCycle = () => {
      if (cancelled) return;
      const from = CYCLE[i]!;
      const to = CYCLE[(i + 1) % CYCLE.length]!;

      paint(okeLogoMarkSvg(from));

      later(() => {
        if (cancelled) return;
        const stepMs = FADE_MS / FAVICON_FADE_STEPS;
        for (let s = 1; s <= FAVICON_FADE_STEPS; s++) {
          const t = s / FAVICON_FADE_STEPS;
          later(() => {
            if (cancelled) return;
            paint(okeLogoMarkCrossfadeSvg(from, to, t));
            if (s === FAVICON_FADE_STEPS) {
              i = (i + 1) % CYCLE.length;
              later(runCycle, 0);
            }
          }, s * stepMs);
        }
      }, holdMs);
    };

    runCycle();

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [intervalMs]);

  return null;
}
