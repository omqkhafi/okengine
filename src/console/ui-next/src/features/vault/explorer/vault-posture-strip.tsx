/**
 * Compact posture strip — backend + risk facets under the explorer search.
 */

import type { JSX } from "react";
import {
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils.ts";
import type { VaultBackendCard as VaultBackendCardModel } from "../lib/backend.ts";
import type { RewrapProgressLine } from "../lib/progress.ts";
import { hasIsToken, toggleIsToken } from "../lib/search.ts";
import { postureHint, VAULT_POSTURE_FACETS, type VaultPostureSummary } from "../lib/posture.ts";
import { VAULT_ACCENT } from "../lib/theme.ts";

/** Props for {@link VaultPostureStrip}. */
export interface VaultPostureStripProps {
  readonly card: VaultBackendCardModel | null;
  readonly env: string;
  readonly summary: VaultPostureSummary;
  readonly query: string;
  readonly progress: RewrapProgressLine | null;
  readonly verifyNote: string | null;
  readonly onQueryChange: (query: string) => void;
  readonly onOpenSecurity: () => void;
}

/**
 * Status + filter tokens under the search bar (Monitoring health-strip rhythm).
 *
 * @param props - Backend card + counts
 */
export function VaultPostureStrip({
  card,
  env,
  summary,
  query,
  progress,
  verifyNote,
  onQueryChange,
  onOpenSecurity,
}: VaultPostureStripProps): JSX.Element {
  return (
    <section
      aria-label="Vault posture"
      className="shrink-0 border-b border-border/60"
      data-slot="vault-posture-strip"
    >
      <div className="flex min-h-10 flex-wrap items-stretch">
        <button
          type="button"
          onClick={onOpenSecurity}
          aria-label="Open vault security"
          className="flex items-center px-2 text-left text-xs font-medium text-foreground hover:bg-muted/50"
        >
          {card?.title ?? "Vault backend"}
        </button>
        <span className="flex items-center px-2 font-mono text-[10px] text-muted-foreground">
          {env}
        </span>
        {card?.badges.map((badge) => (
          <span
            key={badge.id}
            role={badge.tone === "warn" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-1.5 px-2 text-[10px]",
              badge.tone === "warn"
                ? "text-amber-800 dark:text-amber-400"
                : "text-muted-foreground",
              badge.id === "rewrap" && "text-[color:var(--vault-accent)]",
            )}
            style={
              badge.id === "rewrap" ? { ["--vault-accent" as string]: VAULT_ACCENT } : undefined
            }
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                badge.tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/50",
                badge.id === "rewrap" && "bg-[var(--vault-accent)]",
              )}
            />
            {badge.label}
          </span>
        ))}
        {VAULT_POSTURE_FACETS.map((facet) => {
          const count = summary[facet.id];
          const pressed = hasIsToken(query, facet.token);
          if (count === 0 && !pressed) return null;
          return (
            <ToolbarTip key={facet.id} label={postureHint(facet.id)} className="flex self-stretch">
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => onQueryChange(toggleIsToken(query, facet.token))}
                className={cn(
                  EXPLORER_STRIP_TOKEN_CLASS,
                  pressed ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                  facet.tone === "danger" && !pressed && "text-destructive",
                  facet.tone === "warn" && !pressed && "text-amber-800 dark:text-amber-400",
                )}
              >
                {facet.label}
                <span className="font-mono tabular-nums">{count}</span>
              </button>
            </ToolbarTip>
          );
        })}
        <span className="ml-auto flex items-center px-2 font-mono text-[10px] text-muted-foreground">
          {verifyNote ?? `${summary.secrets}s · ${summary.config}c`}
        </span>
      </div>
      {progress ? (
        <p
          className="border-t border-border/60 px-2 py-1 font-mono text-[11px]"
          style={{ color: VAULT_ACCENT }}
          role="status"
          data-slot="vault-rewrap-progress"
          data-phase={progress.phase}
        >
          {progress.headline}
          <span className="ml-2 font-sans text-muted-foreground">{progress.detail}</span>
        </p>
      ) : null}
    </section>
  );
}
