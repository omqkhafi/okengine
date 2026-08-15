/**
 * Vault contract inspector — one action path, selectable lock-path, copy menu.
 */

import {
  Alert02Icon,
  Award01Icon,
  Clock01Icon,
  File01Icon,
  Key01Icon,
  MoreHorizontalCircle01Icon,
  SourceCodeIcon,
  UnavailableIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type JSX } from "react";
import { CopyInlineButton } from "@/components/explorer/copy-inline-button.tsx";
import { DetailHeader } from "@/components/explorer/detail-header.tsx";
import { SectionHead } from "@/components/explorer/section-head.tsx";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { ELEMENT_ICONS, type ElementHugeIcon } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils.ts";
import { formatBlastRadius, formatDuration } from "../lib/blast-radius.ts";
import {
  vaultDotenvLine,
  vaultFxSnippet,
  vaultLayerFill,
  vaultRotateCli,
  vaultSetCli,
} from "../lib/contract-ops.ts";
import { exportSafeRow } from "../lib/export-safe.ts";
import {
  contractPosture,
  formatRelativeTime,
  isRotateCadence,
  postureHint,
  postureLabel,
  rotatePolicyLabel,
} from "../lib/posture.ts";
import { vaultDriverKind, vaultDriverTitle } from "../lib/backend.ts";
import { VAULT_ACCENT, VAULT_WELL } from "../lib/theme.ts";
import type {
  VaultBackend,
  VaultRecord,
  VaultResolutionSource,
  VaultResolutionStep,
} from "../lib/types.ts";

/** Props for {@link VaultDetail}. */
export interface VaultDetailProps {
  readonly row: VaultRecord;
  readonly env: string;
  readonly now: number;
  readonly backend?: VaultBackend | null;
  readonly onSet: () => void;
  readonly onRotate: () => void;
  readonly onQueryChange?: (query: string) => void;
}

const SOURCE_SHORT: Readonly<Record<VaultResolutionSource, string>> = {
  driver: "driver",
  "process.env": "env",
  ".env.local": "local",
  "dev-fallback": "fallback",
};

const SOURCE_ICON: Readonly<Record<VaultResolutionSource, ElementHugeIcon>> = {
  driver: Key01Icon,
  "process.env": SourceCodeIcon,
  ".env.local": File01Icon,
  "dev-fallback": UnavailableIcon,
};

const WON_INK = "text-emerald-700 dark:text-emerald-400";
const WON_WASH = "bg-emerald-500/10";
const WON_WASH_ACTIVE = "bg-emerald-500/15";

const RESOLUTION_ORDER: readonly VaultResolutionSource[] = [
  "driver",
  "process.env",
  ".env.local",
  "dev-fallback",
];

function resolutionSteps(row: VaultRecord): readonly VaultResolutionStep[] {
  const raw =
    row.resolution.length > 0
      ? row.resolution
      : RESOLUTION_ORDER.map((source) => ({
          source,
          present: false,
          won: row.winner === source,
        }));
  const bySource = new Map(raw.map((step) => [step.source, step]));
  return RESOLUTION_ORDER.map(
    (source) =>
      bySource.get(source) ?? {
        source,
        present: false,
        won: row.winner === source,
      },
  );
}

function defaultLayer(steps: readonly VaultResolutionStep[]): VaultResolutionSource {
  return (
    steps.find((s) => s.won)?.source ?? steps.find((s) => !s.present)?.source ?? steps[0]!.source
  );
}

/**
 * Right-pane contract inspector.
 *
 * @param props - Selected row + write triggers
 */
export function VaultDetail({
  row,
  env,
  now,
  backend = null,
  onSet,
  onRotate,
  onQueryChange,
}: VaultDetailProps): JSX.Element {
  const blast = formatBlastRadius(row.blastRadius);
  const posture = contractPosture(row, now);
  const label = row.description ?? row.name;
  const slots = fingerprintSlots(row, env);
  const steps = resolutionSteps(row);
  const winnerStep = steps.find((s) => s.won) ?? null;
  const [layer, setLayer] = useState<VaultResolutionSource>(() => defaultLayer(steps));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setLayer(defaultLayer(resolutionSteps(row)));
  }, [row.name]);

  const selected = steps.find((s) => s.source === layer) ?? steps[0]!;
  const fill = vaultLayerFill(selected.source, row.name, backend);
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto"
      data-slot="vault-detail"
      aria-label="Vault detail"
      aria-live="polite"
    >
      <DetailHeader
        dataSlot="vault-detail-header"
        icon={<HugeiconsIcon icon={ELEMENT_ICONS.vault.icon} className="size-4" />}
        wellClassName="border-border/70"
        wellStyle={{ backgroundColor: VAULT_WELL, color: VAULT_ACCENT }}
        title={label}
        badge={
          <>
            <span className="font-mono text-[10px] text-muted-foreground uppercase">
              {row.kind}
            </span>
            {row.kind === "secret" ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                {rotatePolicyLabel(row.rotate)}
              </span>
            ) : null}
            {row.origin === "console" ? (
              <span className="font-mono text-[10px] text-muted-foreground">console</span>
            ) : null}
            <span className="font-mono text-[10px] text-muted-foreground">
              {vaultDriverKind(backend)}
            </span>
          </>
        }
        subtitle={
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <code className="min-w-0 truncate font-mono text-[11px] text-foreground/80">
              {row.name}
            </code>
            <CopyInlineButton value={row.name} label={`Copy ${row.name}`} />
            {posture.risks.map((risk) => (
              <ToolbarTip key={risk} label={postureHint(risk, row.rotate)}>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border px-1.5 py-px text-[10px] hover:bg-muted/60",
                    risk === "blast" && "border-destructive/30 text-destructive",
                    (risk === "unset" || risk === "overdue" || risk === "shared") &&
                      "border-amber-500/30 text-amber-800 dark:text-amber-400",
                    risk === "dormant" && "border-border/60 text-muted-foreground",
                  )}
                  onClick={() => onQueryChange?.(`is:${risk}`)}
                >
                  {postureLabel(risk)}
                </button>
              </ToolbarTip>
            ))}
          </div>
        }
        actions={
          <>
            <CopyMenu row={row} />
            {posture.unset ? null : (
              <ToolbarTip
                label={
                  row.kind === "config"
                    ? "Updates this vault.config value. Console shows it in the clear."
                    : "Write-only. The new value is never shown again."
                }
              >
                <Button type="button" variant="outline" size="sm" onClick={onSet}>
                  Set
                </Button>
              </ToolbarTip>
            )}
            <ToolbarTip
              label={
                posture.unset
                  ? "Set a value before rotate"
                  : blast.warn
                    ? blast.summary
                    : "Re-encrypt with a new value. Review the fingerprint before it writes."
              }
            >
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={posture.unset}
                onClick={onRotate}
              >
                Rotate
              </Button>
            </ToolbarTip>
          </>
        }
      />

      <NextAction
        row={row}
        env={env}
        postureUnset={posture.unset}
        blastWarn={blast.warn}
        blastSummary={blast.summary}
        blastDetail={blast.detail}
        overdue={posture.overdue}
        onSet={onSet}
      />

      <dl
        className="grid shrink-0 grid-cols-2 border-b border-border/60 lg:grid-cols-4"
        data-slot="vault-briefing"
      >
        <Brief
          icon={Award01Icon}
          label="Winner"
          value={row.winner ?? "none"}
          hint={
            winnerStep
              ? row.winner === "driver"
                ? vaultDriverTitle(backend)
                : "First layer that had a value"
              : "No layer provided a value"
          }
          warn={!row.winner}
          won={Boolean(row.winner)}
          onClick={
            onQueryChange
              ? () => onQueryChange(row.winner ? `from:${row.winner}` : "is:unset")
              : undefined
          }
        />
        <Brief
          icon={Clock01Icon}
          label="Last read"
          value={row.lastReadAt != null ? formatRelativeTime(row.lastReadAt, now) : "never"}
          hint={
            row.lastReadAt != null ? new Date(row.lastReadAt).toISOString() : "Possible dead secret"
          }
          warn={row.lastReadAt == null && row.kind === "secret"}
          onClick={onQueryChange ? () => onQueryChange("is:dormant") : undefined}
        />
        <Brief
          icon={UserMultipleIcon}
          label="Readers"
          value={String(row.readers.length)}
          hint={row.readers.length === 0 ? "No Flow declares a read" : row.readers.join(", ")}
          onClick={
            onQueryChange && row.readers[0]
              ? () => onQueryChange(`reader:${row.readers[0]}`)
              : undefined
          }
        />
        <Brief
          icon={Alert02Icon}
          label="Blast"
          value={
            row.blastRadius.count === 0
              ? "clear"
              : `${row.blastRadius.count} run${row.blastRadius.count === 1 ? "" : "s"}`
          }
          hint={
            blast.detail ??
            (row.blastRadius.longestOutstandingMs != null
              ? formatDuration(row.blastRadius.longestOutstandingMs)
              : blast.summary)
          }
          warn={blast.warn}
          onClick={onQueryChange ? () => onQueryChange("is:blast") : undefined}
        />
      </dl>

      <div className="flex flex-col gap-4 px-3 py-3">
        <section className="flex flex-col gap-2" aria-label="Resolution chain">
          <SectionHead title="Resolution" meta="first hit wins · pick a layer to fill" />
          <ol className="grid grid-cols-4 gap-1" data-slot="vault-lock-path">
            {steps.map((step, index) => {
              const active = step.source === selected.source;
              return (
                <li key={step.source} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setLayer(step.source)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-md px-1 py-1.5 text-left hover:bg-muted/50",
                      step.won && WON_WASH,
                      active && !step.won && "bg-muted/70",
                      active && step.won && WON_WASH_ACTIVE,
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full border",
                          step.won && "border-emerald-500 bg-emerald-500",
                          !step.won &&
                            step.present &&
                            "border-muted-foreground/50 bg-muted-foreground/40",
                          !step.won && !step.present && "border-border bg-transparent",
                        )}
                        aria-hidden
                      />
                      {index < steps.length - 1 ? (
                        <span
                          className={cn(
                            "h-px min-w-0 flex-1",
                            step.won ? "bg-emerald-500/40" : "bg-border/70",
                          )}
                          aria-hidden
                        />
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "flex min-w-0 items-center gap-1 font-mono text-[11px]",
                        step.won ? WON_INK : "text-muted-foreground",
                      )}
                    >
                      <HugeiconsIcon
                        icon={SOURCE_ICON[step.source]}
                        className="size-3 shrink-0"
                        aria-hidden
                      />
                      {SOURCE_SHORT[step.source]}
                      {step.source === "driver" ? (
                        <span
                          className={cn(
                            "ml-auto truncate font-sans text-[10px] font-medium",
                            step.won
                              ? "text-emerald-800 dark:text-emerald-300"
                              : "text-foreground/75",
                          )}
                        >
                          {vaultDriverKind(backend)}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn("text-[10px]", step.won ? WON_INK : "text-muted-foreground")}
                    >
                      {step.won ? "won" : step.present ? "lost" : "absent"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-2",
              selected.won ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60",
            )}
          >
            <HugeiconsIcon
              icon={SOURCE_ICON[selected.source]}
              className={cn("size-3.5 shrink-0", selected.won ? WON_INK : "text-muted-foreground")}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn("font-mono text-[11px]", selected.won ? WON_INK : "text-foreground")}
              >
                {selected.source === "driver" ? vaultDriverTitle(backend) : selected.source}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">{fill.hint}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{fill.command}</p>
            </div>
            <CopyInlineButton value={fill.command} label={`Copy ${selected.source} fill`} />
          </div>
          <p className="sr-only">Winner: {row.winner ?? "none"}</p>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-1.5" aria-label="Fingerprints by environment">
            <SectionHead
              title={row.sensitive ? "Fingerprints" : "Value"}
              meta={row.sensitive ? `${slots.length} env` : env}
            />
            {row.sensitive ? (
              <FingerprintTable slots={slots} env={env} />
            ) : (
              <p className="font-mono text-[12px]" role="status">
                {row.cleartext ?? "unset"}
              </p>
            )}
          </section>
          <VaultReaders
            readers={row.readers}
            name={row.name}
            onFilterReader={onQueryChange ? (id) => onQueryChange(`reader:${id}`) : undefined}
          />
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground">
            Advanced
            <span className="font-mono font-normal tracking-normal normal-case">
              {advancedOpen ? "hide" : "write · meta"}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-2">
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Set</span>
              {posture.unset ? " closes the boot gap." : " overwrites the winning layer."}{" "}
              <span className="font-medium text-foreground">Rotate</span>
              {posture.unset
                ? " stays disabled until a value exists."
                : blast.warn
                  ? ` — ${blast.summary}`
                  : " — in-flight durable runs wake on the new key."}{" "}
              Both ask for a reason, then a review dialog. No secret preview.
            </p>
            <dl className="flex flex-col">
              {(
                [
                  ["env", env],
                  ["sensitive", row.sensitive ? "yes" : "no"],
                  ["cadence", row.rotate ?? "none"],
                  [
                    "last read",
                    row.lastReadAt != null
                      ? `${formatRelativeTime(row.lastReadAt, now)} · ${new Date(row.lastReadAt).toISOString()}`
                      : "never",
                  ],
                  [
                    "shared",
                    row.sharedFingerprintEnvs.length > 0
                      ? row.sharedFingerprintEnvs.join(", ")
                      : "none",
                  ],
                  [
                    "runs",
                    row.blastRadius.runIds.length > 0 ? row.blastRadius.runIds.join(", ") : "none",
                  ],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3 border-t border-border/40 py-1 first:border-t-0"
                >
                  <dt className="shrink-0 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                    {k}
                  </dt>
                  <dd className="min-w-0 truncate text-right font-mono text-[11px]">{v}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function CopyMenu({ row }: { readonly row: VaultRecord }): JSX.Element {
  const items = [
    { id: "fx", label: "Flow read", value: vaultFxSnippet(row.name) },
    { id: "set", label: "oke vault set", value: vaultSetCli(row.name) },
    { id: "rotate", label: "oke vault rotate", value: vaultRotateCli(row.name) },
    { id: "env", label: ".env assignment", value: vaultDotenvLine(row.name) },
    {
      id: "json",
      label: "Export fingerprints",
      value: JSON.stringify(exportSafeRow(row), null, 2),
    },
  ] as const;
  return (
    <DropdownMenu>
      <ToolbarTip label="Copy snippets (no secret values)">
        <DropdownMenuTrigger
          render={(props) => (
            <Button {...props} type="button" variant="ghost" size="icon-xs" aria-label="Copy">
              <HugeiconsIcon icon={MoreHorizontalCircle01Icon} />
            </Button>
          )}
        />
      </ToolbarTip>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          {items.slice(0, 4).map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={() => {
                void navigator.clipboard?.writeText(item.value);
              }}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard?.writeText(items[4]!.value);
          }}
        >
          Export fingerprints
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NextAction({
  row,
  env,
  postureUnset,
  blastWarn,
  blastSummary,
  blastDetail,
  overdue,
  onSet,
}: {
  readonly row: VaultRecord;
  readonly env: string;
  readonly postureUnset: boolean;
  readonly blastWarn: boolean;
  readonly blastSummary: string;
  readonly blastDetail: string | null;
  readonly overdue: boolean;
  readonly onSet: () => void;
}): JSX.Element | null {
  if (blastWarn) {
    return (
      <section
        className="shrink-0 border-b border-destructive/25 bg-destructive/5 px-3 py-2.5"
        aria-label="Rotation blast radius"
        role="alert"
      >
        <p className="text-[12px] font-medium text-destructive">Blast radius</p>
        <p className="mt-0.5 text-[11px] text-foreground/90">{blastSummary}</p>
        {blastDetail ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{blastDetail}</p>
        ) : null}
        {row.blastRadius.runIds.length > 0 ? (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {row.blastRadius.runIds.join(", ")}
          </p>
        ) : null}
      </section>
    );
  }
  if (postureUnset) {
    return (
      <section
        className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/25 bg-amber-500/5 px-3 py-2.5"
        aria-label="Unset contract"
        role="status"
      >
        <p className="min-w-0 text-[12px] text-amber-900 dark:text-amber-300">
          No value in {env}
          {row.readers[0] ? (
            <span className="text-muted-foreground">
              {" "}
              · <span className="font-mono">{row.readers[0]}</span> will fail boot
            </span>
          ) : (
            <span className="text-muted-foreground"> · boot gap until a layer provides one</span>
          )}
        </p>
        <Button type="button" size="sm" onClick={onSet} className="shrink-0">
          Set {row.name}
        </Button>
      </section>
    );
  }
  if (overdue && isRotateCadence(row.rotate)) {
    return (
      <section
        className="shrink-0 border-b border-amber-500/25 bg-amber-500/5 px-3 py-2.5"
        aria-label="Rotation overdue"
        role="status"
      >
        <p className="text-[12px] text-amber-900 dark:text-amber-300">
          Past rotate {row.rotate}
          <span className="text-muted-foreground"> · rotate when blast is clear</span>
        </p>
      </section>
    );
  }
  return null;
}

function Brief({
  icon,
  label,
  value,
  hint,
  warn = false,
  won = false,
  onClick,
}: {
  readonly icon: ElementHugeIcon;
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly warn?: boolean;
  readonly won?: boolean;
  readonly onClick?: () => void;
}): JSX.Element {
  const inner = (
    <>
      <dt className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        <HugeiconsIcon icon={icon} className="size-3 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd
        className={cn(
          "truncate font-mono text-[12px]",
          warn ? "text-amber-800 dark:text-amber-400" : won ? WON_INK : "text-foreground",
        )}
      >
        {value}
      </dd>
      <dd className="truncate text-[10px] text-muted-foreground">{hint}</dd>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/40"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex flex-col gap-0.5 px-3 py-2">{inner}</div>;
}

function FingerprintTable({
  slots,
  env,
}: {
  readonly slots: readonly FingerprintSlot[];
  readonly env: string;
}): JSX.Element {
  return (
    <table className="w-full text-left" data-slot="vault-fingerprints">
      <caption className="sr-only">Fingerprints by environment</caption>
      <tbody>
        {slots.map((slot) => (
          <tr key={slot.env} className="border-t border-border/40 first:border-t-0">
            <td className="py-1 pr-3 align-top">
              <span className="font-mono text-[11px] text-muted-foreground">{slot.env}</span>
              {slot.env === env ? (
                <span className="ml-1 text-[10px] text-muted-foreground">this</span>
              ) : null}
            </td>
            <td className="py-1 align-top">
              {slot.fp ? (
                <span className="font-mono text-[11px] break-all">{slot.fp}</span>
              ) : (
                <span className="text-[11px] text-muted-foreground">—</span>
              )}
              {slot.shared ? (
                <p role="status" className="text-[10px] text-amber-800 dark:text-amber-400">
                  matches {env}
                </p>
              ) : null}
            </td>
            <td className="w-8 py-1 align-top">
              {slot.fp ? (
                <CopyInlineButton value={slot.fp} label={`Copy ${slot.env} fingerprint`} />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface FingerprintSlot {
  readonly env: string;
  readonly fp: string | null;
  readonly shared: boolean;
}

function fingerprintSlots(row: VaultRecord, env: string): readonly FingerprintSlot[] {
  const seen = new Set<string>();
  const out: FingerprintSlot[] = [];
  const push = (e: string, fp: string | null) => {
    if (seen.has(e)) return;
    seen.add(e);
    out.push({
      env: e,
      fp,
      shared: fp != null && row.sharedFingerprintEnvs.includes(e),
    });
  };
  push(env, row.fingerprint);
  for (const [e, fp] of Object.entries(row.fingerprints)) push(e, fp);
  return out;
}

/**
 * Readers — flows that declare fx.vault.get.
 *
 * @param props - Flow ids + secret name
 */
function VaultReaders({
  readers,
  name,
  onFilterReader,
}: {
  readonly readers: readonly string[];
  readonly name: string;
  readonly onFilterReader?: (id: string) => void;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-1.5" aria-label="Readers">
      <SectionHead title="Readers" meta={`${readers.length}`} />
      <p className="text-[11px] text-muted-foreground">
        <code className="font-mono">fx.vault.get({name})</code>
      </p>
      {readers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">None declared.</p>
      ) : (
        <ul className="flex flex-col">
          {readers.map((id) => (
            <li
              key={id}
              className="flex items-center gap-2 border-t border-border/40 py-1 first:border-t-0"
            >
              <span
                className="flex size-5 shrink-0 items-center justify-center text-sky-500"
                aria-hidden
              >
                <HugeiconsIcon icon={ELEMENT_ICONS.flow.icon} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{id}</span>
              {onFilterReader ? (
                <button
                  type="button"
                  className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => onFilterReader(id)}
                >
                  filter
                </button>
              ) : null}
              <Link
                to="/flows"
                search={{ flow: id }}
                className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Flows
              </Link>
              <Link
                to="/overview"
                search={{ flow: id }}
                className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Graph
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
