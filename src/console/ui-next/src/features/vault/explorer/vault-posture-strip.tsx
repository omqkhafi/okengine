/**
 * Compact posture strip — backend + risk facets under the explorer search.
 */

import type { JSX } from "react";
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
 * Status + filter chips under the search bar (Units advanced-filter rhythm).
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
      className="shrink-0 border-b border-border/60 bg-muted/20"
      data-slot="vault-posture-strip"
    >
      <div className="flex flex-col gap-1.5 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenSecurity}
            aria-label="Open vault security"
            className="min-w-0 truncate text-left text-[11px] font-medium text-foreground hover:underline"
          >
            {card?.title ?? "Vault backend"}
          </button>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{env}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {verifyNote ?? `${summary.secrets}s · ${summary.config}c`}
          </span>
        </div>
        {card?.badges.length ? (
          <div className="flex flex-wrap items-center gap-1">
            {card.badges.map((badge) => (
              <span
                key={badge.id}
                role={badge.tone === "warn" ? "alert" : "status"}
                className={cn(
                  "inline-flex h-5 items-center rounded-md border px-1.5 text-[10px]",
                  badge.tone === "warn"
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-400"
                    : "border-border/60 bg-background/50 text-muted-foreground",
                  badge.id === "rewrap" && "border-[color:var(--vault-accent)]/40",
                )}
                style={
                  badge.id === "rewrap" ? { ["--vault-accent" as string]: VAULT_ACCENT } : undefined
                }
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
        {VAULT_POSTURE_FACETS.some(
          (facet) => summary[facet.id] > 0 || hasIsToken(query, facet.token),
        ) ? (
          <div
            className="flex flex-wrap items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
            role="group"
            aria-label="Posture filter"
          >
            {VAULT_POSTURE_FACETS.map((facet) => {
              const count = summary[facet.id];
              const pressed = hasIsToken(query, facet.token);
              if (count === 0 && !pressed) return null;
              return (
                <ToolbarTip key={facet.id} label={postureHint(facet.id)}>
                  <button
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onQueryChange(toggleIsToken(query, facet.token))}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                      pressed
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
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
          </div>
        ) : null}
      </div>
      {progress ? (
        <p
          className="border-t border-border/50 px-2 py-1 font-mono text-[11px]"
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
