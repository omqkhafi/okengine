/**
 * Brand mark and wordmark for the header strip.
 *
 * The mark is a square ring with a solid core — the kernel inside the shell.
 * It is drawn as a single evenodd path so it stays legible at 16px and inherits
 * `currentColor` in both themes.
 */

/**
 * Square-ring mark.
 *
 * @param className - Sizing / colour classes
 */
export function OkeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path fillRule="evenodd" d="M0 0h24v24H0V0Zm3 3v18h18V3H3Z" />
      <path d="M8 8h8v8H8z" />
    </svg>
  );
}

/**
 * Full lockup: mark plus letterspaced wordmark.
 *
 * @param className - Extra classes for the wrapper
 */
export function OkeWordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <OkeMark className="size-3.5 shrink-0" />
      <span className="font-mono text-[13px] font-medium tracking-[0.14em] whitespace-nowrap uppercase">
        okengine<span className="text-fd-muted-foreground">.</span>
      </span>
    </span>
  );
}
