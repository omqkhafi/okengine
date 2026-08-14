/**
 * Reverse readers / writers for the selected store child.
 */

import type { JSX } from "react";
import { Link } from "@tanstack/react-router";
import type { StoreListChild } from "@/client.ts";
import { sortedFlowIds } from "../lib/resource-effects.ts";

/** Props for {@link TouchedBySection}. */
export interface TouchedBySectionProps {
  readonly child: StoreListChild;
}

/**
 * Lists Manifest flows that read or write this resource.
 *
 * @param props - Selected store child
 */
export function TouchedBySection({ child }: TouchedBySectionProps): JSX.Element {
  return (
    <section className="flex flex-col gap-4" data-slot="touched-by-section" aria-label="Touched by">
      <TouchedByLists child={child} />
    </section>
  );
}

/**
 * Writers + Readers lists without the section chrome — for toolbar popovers.
 *
 * @param props - Selected store child
 */
export function TouchedByLists({ child }: { readonly child: StoreListChild }): JSX.Element {
  const writers = sortedFlowIds(child.writers);
  const readers = sortedFlowIds(child.readers);

  return (
    <div className="flex flex-col gap-4" data-slot="touched-by-lists">
      <FlowIdList
        title="Writers"
        ids={writers}
        empty="No Manifest flow declares writes for this resource."
      />
      <FlowIdList
        title="Readers"
        ids={readers}
        empty="No Manifest flow declares reads for this resource."
      />
    </div>
  );
}

function FlowIdList({
  title,
  ids,
  empty,
}: {
  readonly title: string;
  readonly ids: readonly string[];
  readonly empty: string;
}): JSX.Element {
  return (
    <div
      className="flex flex-col gap-1.5"
      data-slot="touched-by-list"
      data-kind={title.toLowerCase()}
    >
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </h3>
      {ids.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {ids.map((id) => (
            <li
              key={id}
              className="flex flex-wrap items-center gap-2 font-mono text-xs text-foreground/90"
            >
              <span>{id}</span>
              <Link
                to="/flows"
                search={{ flow: id }}
                className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Flows
              </Link>
              <Link
                to="/overview"
                search={{ flow: id }}
                className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Graph
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
