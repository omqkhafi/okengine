/**
 * Syntax-highlighted file change disclosure (beUI File Diff).
 *
 * @see https://beui.dev/components/agents/file-diff
 */

import {
  ArrowDown01Icon,
  Copy01Icon,
  Loading03Icon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  AgentCodeLine,
  useAgentCodeTokens,
  type AgentCodeLanguage,
} from "@/components/agents/agent-code.tsx";
import { AgentDisclosure } from "@/components/agents/agent-disclosure.tsx";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/ease.ts";
import { cn } from "@/lib/utils.ts";

/** Streaming vs settled File Diff. */
export type FileDiffStatus = "streaming" | "complete";

/** Line kind in a unified diff. */
export type FileDiffLineType = "added" | "removed" | "context";

/** One row in {@link FileDiff}. */
export interface FileDiffLine {
  readonly id: string;
  readonly type?: FileDiffLineType;
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly content: string;
}

/** Props for {@link FileDiff}. */
export interface FileDiffProps {
  readonly file: ReactNode;
  readonly lines: readonly FileDiffLine[];
  readonly status?: FileDiffStatus;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly collapseOnComplete?: boolean;
  readonly maxHeight?: number;
  readonly language?: AgentCodeLanguage;
  readonly copyText?: string;
  readonly onCopy?: () => void | Promise<void>;
  readonly className?: string;
}

function ChangeCount({
  value,
  type,
}: {
  readonly value: number;
  readonly type: "added" | "removed";
}): JSX.Element | null {
  if (!value) return null;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        type === "added"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400",
      )}
    >
      {type === "added" ? "+" : "−"}
      {value}
    </span>
  );
}

/**
 * File change disclosure with line numbers, +/- counts, and copy.
 *
 * @param props - File label + unified-diff lines
 */
export function FileDiff({
  file,
  lines,
  status = "streaming",
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  maxHeight = 220,
  language = "typescript",
  copyText,
  onCopy,
  className,
}: FileDiffProps): JSX.Element {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const copyTimer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const streaming = status === "streaming";
  const additions = lines.filter((line) => line.type === "added").length;
  const deletions = lines.filter((line) => line.type === "removed").length;
  const canCopy = Boolean(copyText || onCopy);
  const code = lines.map((line) => line.content).join("\n");
  const tokens = useAgentCodeTokens(code, language);

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (previousStatus.current !== "streaming" && status === "streaming") {
      setOpen(true);
    }
    if (previousStatus.current === "streaming" && status === "complete" && collapseOnComplete) {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [collapseOnComplete, setOpen, status]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !currentOpen || !streaming) return;

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  const handleCopy = useCallback(async () => {
    if (onCopy) await onCopy();
    else if (copyText) await navigator.clipboard?.writeText(copyText);
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [copyText, onCopy]);

  return (
    <div data-state={status} aria-busy={streaming} className={cn("w-full text-sm", className)}>
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex min-h-9 w-full items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <HugeiconsIcon
          icon={SourceCodeIcon}
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file}</span>
        <ChangeCount value={additions} type="added" />
        <ChangeCount value={deletions} type="removed" />
        {streaming ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            aria-label="Applying changes"
            className={cn("size-3.5 text-muted-foreground", !reduce && "animate-spin")}
          />
        ) : null}
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="shrink-0 text-muted-foreground/45 transition-colors group-hover:text-muted-foreground"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure id={contentId} role="region" aria-labelledby={triggerId} open={currentOpen}>
        <div className="relative overflow-hidden rounded-lg border border-border/70 bg-muted/20">
          <div
            ref={viewportRef}
            data-slot="file-diff-viewport"
            aria-live="polite"
            className="overflow-auto"
            style={{ maxHeight }}
          >
            <div className="sr-only">File changes</div>
            {lines.map((line, index) => {
              const type = line.type ?? "context";
              return (
                <div
                  key={line.id}
                  className={cn(
                    "grid grid-cols-[1.5rem_0.75rem_minmax(0,1fr)] items-start font-mono text-xs leading-5",
                    type === "added" && "bg-emerald-500/[0.07]",
                    type === "removed" && "bg-rose-500/[0.07]",
                  )}
                >
                  <span className="select-none pl-1 pr-0.5 text-right text-muted-foreground/45 tabular-nums">
                    {line.newLine ?? line.oldLine ?? ""}
                  </span>
                  <span
                    className={cn(
                      "select-none text-center text-muted-foreground/45",
                      type === "added" && "text-emerald-600 dark:text-emerald-400",
                      type === "removed" && "text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {type === "added" ? "+" : type === "removed" ? "−" : ""}
                  </span>
                  <AgentCodeLine
                    code={line.content}
                    tokens={tokens?.[index]}
                    className="block min-w-0 whitespace-pre-wrap break-all pr-1.5 pl-1"
                  />
                </div>
              );
            })}
          </div>

          {canCopy ? (
            <motion.button
              type="button"
              aria-label={copied ? "Copied" : "Copy diff"}
              title={copied ? "Copied" : "Copy diff"}
              onClick={() => void handleCopy()}
              whileTap={reduce ? undefined : { scale: 0.9 }}
              transition={SPRING_PRESS}
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-3.5" />
            </motion.button>
          ) : null}
        </div>
      </AgentDisclosure>
    </div>
  );
}
