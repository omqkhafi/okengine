/**
 * Vault empty pane — only when the list has nothing to inspect.
 */

import type { JSX } from "react";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";

/** Props for {@link VaultOverview}. */
export interface VaultOverviewProps {
  readonly loading?: boolean;
  readonly hasContracts: boolean;
  readonly query: string;
  readonly onClearQuery: () => void;
}

/**
 * Empty inspector — loading, no Manifest contracts, or no search hits.
 *
 * @param props - List state
 */
export function VaultOverview({
  loading = false,
  hasContracts,
  query,
  onClearQuery,
}: VaultOverviewProps): JSX.Element {
  if (loading) {
    return (
      <div data-slot="vault-overview" className="h-full">
        <ExplorerEmpty
          icon={ELEMENT_ICONS.vault.icon}
          iconClassName="border-border/70"
          title="Loading vault…"
          description="Reading contracts and posture."
        />
      </div>
    );
  }

  return (
    <div data-slot="vault-overview" className="h-full">
      <ExplorerEmpty
        icon={ELEMENT_ICONS.vault.icon}
        iconClassName="border-border/70"
        title={hasContracts ? "No contracts match" : "No contracts"}
        description={
          hasContracts ? (
            <>
              Nothing matches <span className="font-mono">{query}</span>.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={onClearQuery}
              >
                Clear search
              </button>
            </>
          ) : (
            "Declare a vault.secret or vault.config in the Manifest."
          )
        }
      />
    </div>
  );
}
