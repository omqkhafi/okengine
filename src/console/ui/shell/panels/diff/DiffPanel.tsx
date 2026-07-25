/**
 * Manifest Diff panel — blast radius of a deploy (console §9.12).
 *
 * Pure read/compare view. Classification is from `diffManifest` via the
 * server projection — this UI only renders. No confirm dialogs, no preview.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useMemo } from "react";
import {
  DIFF_CATEGORY_LABELS,
  DIFF_CATEGORY_ORDER,
  filterChanges,
  formatCiGate,
  groupByCategory,
  parseDiffSearch,
  serializeDiffSearch,
  type DiffListResponse,
  type DiffSearch,
} from "../../../diff/index.ts";
import { consoleCalls } from "../../client.ts";

/**
 * Manifest Diff panel.
 *
 * Works on `/manifest-diff` and the `/diff` alias (AI deep-links).
 */
export function DiffPanel() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rawSearch = useRouterState({ select: (s) => s.location.search });
  const search = useMemo(
    () => parseDiffSearch(rawSearch as Record<string, unknown>),
    [rawSearch],
  );
  const navigate = useNavigate();

  const setSearch = (next: DiffSearch) => {
    void navigate({
      to: pathname === "/diff" ? "/diff" : "/manifest-diff",
      search: serializeDiffSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.diff.list"],
    queryFn: async () => {
      const res = await consoleCalls.diffList();
      if (res.error) throw new Error(res.error.code);
      return res.data as DiffListResponse;
    },
    refetchInterval: 10_000,
  });

  const data = listQuery.data;
  const filtered = useMemo(
    () =>
      filterChanges(
        data?.changes ?? [],
        search.q ?? "",
        search.category,
      ),
    [data?.changes, search.q, search.category],
  );
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const focusPath = search.path;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--oke-line)] px-4 py-3">
        <h1 className="text-base font-medium text-[var(--oke-fg)]">
          Manifest Diff
        </h1>
        <p className="text-sm text-[var(--oke-muted)]">
          Blast radius of a deploy — contract, permission, effect, and no-impact.
          Read-only compare of current Manifest vs baseline.
        </p>
        <label className="mt-2 flex max-w-sm flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter</span>
          <input
            aria-label="Filter changes"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
            value={search.q ?? ""}
            onChange={(e) =>
              setSearch({ ...search, q: e.target.value || undefined })
            }
          />
        </label>
        <div
          role="group"
          aria-label="Blast-radius category"
          className="mt-2 flex flex-wrap gap-1"
        >
          <CategoryChip
            label="All"
            pressed={search.category === undefined}
            onClick={() => setSearch({ ...search, category: undefined })}
          />
          {DIFF_CATEGORY_ORDER.map((cat) => (
            <CategoryChip
              key={cat}
              label={DIFF_CATEGORY_LABELS[cat]}
              pressed={search.category === cat}
              onClick={() =>
                setSearch({
                  ...search,
                  category: search.category === cat ? undefined : cat,
                })
              }
            />
          ))}
        </div>
      </header>

      {data?.hasBaseline ? (
        <section
          aria-label="CI gate summary"
          role="status"
          className="shrink-0 border-b border-[var(--oke-line)] px-4 py-2 text-sm"
        >
          <h2 className="sr-only">CI gate</h2>
          <p className="text-[var(--oke-fg)]">
            <span
              className={
                (data.blockedCount ?? 0) > 0
                  ? "text-[var(--oke-fg)]"
                  : "text-[var(--oke-muted)]"
              }
            >
              {data.blockedCount} undeclared break
              {data.blockedCount === 1 ? "" : "s"} blocked
            </span>
            <span className="text-[var(--oke-muted)]"> · </span>
            <span className="text-[var(--oke-muted)]">
              {data.acknowledgedCount} acknowledged with{" "}
              <code className="font-mono text-xs">breaking: true</code>
            </span>
          </p>
        </section>
      ) : null}

      <main id="diff-main" className="min-h-0 flex-1 overflow-y-auto p-4">
        {listQuery.isLoading ? (
          <p className="text-[var(--oke-muted)]">Loading…</p>
        ) : null}
        {listQuery.isError ? (
          <p role="alert">Failed to load Manifest Diff</p>
        ) : null}

        {data && !data.hasBaseline ? (
          <p className="text-[var(--oke-muted)]" role="status">
            No baseline Manifest to compare. Deploy once, or feed a previous
            Manifest, to see blast radius.
          </p>
        ) : null}

        {data?.hasBaseline && groups.length === 0 ? (
          <p className="text-[var(--oke-muted)]" role="status">
            No behavioural changes between baseline and current Manifest.
          </p>
        ) : null}

        {groups.map((group) => (
          <section
            key={group.category}
            aria-label={group.label}
            className="mb-8"
          >
            <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--oke-muted)]">
              {group.label}
              <span className="ml-2 font-mono normal-case">
                ({group.items.length})
              </span>
            </h2>
            <ul className="space-y-3">
              {group.items.map((item) => {
                const gate = formatCiGate(item.ciGate);
                const selected = item.path === focusPath;
                return (
                  <li key={item.path}>
                    <article
                      aria-current={selected ? "true" : undefined}
                      className={clsx(
                        "border border-[var(--oke-line)] px-3 py-3",
                        selected && "bg-[var(--oke-line)]",
                      )}
                    >
                      <button
                        type="button"
                        className="min-h-8 w-full text-left"
                        aria-pressed={selected}
                        onClick={() =>
                          setSearch({
                            ...search,
                            path:
                              search.path === item.path
                                ? undefined
                                : item.path,
                          })
                        }
                      >
                        <h3 className="font-mono text-sm text-[var(--oke-fg)]">
                          {item.path}
                        </h3>
                        <p className="mt-1 text-sm text-[var(--oke-muted)]">
                          {item.summary}
                        </p>
                      </button>
                      {item.blastLine ? (
                        <p
                          role="status"
                          className="mt-2 text-sm text-[var(--oke-fg)]"
                        >
                          {item.blastLine}
                        </p>
                      ) : item.runCountLastWeek > 0 && item.flowName ? (
                        <p className="mt-2 text-sm text-[var(--oke-muted)]">
                          Ran {item.runCountLastWeek.toLocaleString("en-US")}{" "}
                          times last week
                        </p>
                      ) : null}
                      {item.weeklyBillLine ? (
                        <p className="mt-1 text-sm font-medium text-[var(--oke-fg)]">
                          Weekly bill: {item.weeklyBillLine}
                        </p>
                      ) : null}
                      {gate ? (
                        <p
                          role="status"
                          data-ci-gate={item.ciGate ?? undefined}
                          className={clsx(
                            "mt-2 text-sm",
                            item.ciGate === "blocked"
                              ? "text-[var(--oke-fg)]"
                              : "text-[var(--oke-muted)]",
                          )}
                        >
                          {gate}
                        </p>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

function CategoryChip(props: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      className={clsx(
        "min-h-8 px-2 text-xs",
        props.pressed
          ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
          : "text-[var(--oke-muted)]",
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
