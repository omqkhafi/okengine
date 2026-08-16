/**
 * Vault contract inspector — one action path, selectable lock-path, copy menu.
 */

import {
  File01Icon,
  Key01Icon,
  MoreHorizontalCircle01Icon,
  SourceCodeIcon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { CopyInlineButton } from "@/components/explorer/copy-inline-button.tsx";
import { DetailHeader } from "@/components/explorer/detail-header.tsx";
import {
  EXPLORER_BAND_ACTIONS_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Button } from "@/components/ui/button";
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
  type VaultLayerFill,
} from "../lib/contract-ops.ts";
import { exportSafeRow } from "../lib/export-safe.ts";
import {
  contractPosture,
  formatRelativeTime,
  isRotateCadence,
  rotatePolicyLabel,
} from "../lib/posture.ts";
import { vaultDriverKind, vaultDriverTitle } from "../lib/backend.ts";
import { VAULT_ACCENT } from "../lib/theme.ts";
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

function layerStatus(
  step: VaultResolutionStep,
  index: number,
  winnerIndex: number,
): "won" | "shadowed" | "missed" | "skipped" {
  if (step.won) return "won";
  if (winnerIndex >= 0 && index > winnerIndex) return step.present ? "shadowed" : "skipped";
  if (step.present) return "shadowed";
  return "missed";
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
  const bannerSet = posture.unset;
  const bannerRotate =
    posture.overdue && isRotateCadence(row.rotate) && !blast.warn && !posture.unset;

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
        wellStyle={{ color: VAULT_ACCENT }}
        title={label}
        badge={
          <>
            <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
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
          <>
            <code className="min-w-0 truncate font-mono text-[11px] leading-none text-foreground/80">
              {row.name}
            </code>
            <CopyInlineButton value={row.name} label={`Copy ${row.name}`} />
          </>
        }
        actions={
          <>
            <CopyMenu row={row} />
            {bannerSet ? null : (
              <ToolbarTip
                label={
                  row.kind === "config"
                    ? "Updates this vault.config value. Console shows it in the clear."
                    : "Write-only. The new value is never shown again."
                }
                className="flex self-stretch"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-full rounded-none"
                  onClick={onSet}
                >
                  Set
                </Button>
              </ToolbarTip>
            )}
            {bannerSet || bannerRotate ? null : (
              <ToolbarTip
                label={
                  blast.warn
                    ? blast.summary
                    : "Re-encrypt with a new value. Review the fingerprint before it writes."
                }
                className="flex self-stretch"
              >
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-full rounded-none"
                  disabled={blast.warn}
                  onClick={onRotate}
                >
                  Rotate
                </Button>
              </ToolbarTip>
            )}
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
        onRotate={onRotate}
      />

      <div
        className={EXPLORER_STRIP_CLASS}
        data-slot="vault-briefing"
        role="group"
        aria-label="Posture"
      >
        <StatusToken
          label="from"
          value={row.winner ? SOURCE_SHORT[row.winner] : "none"}
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
        <StatusToken
          label="read"
          value={row.lastReadAt != null ? formatRelativeTime(row.lastReadAt, now) : "never"}
          hint={
            row.lastReadAt != null ? new Date(row.lastReadAt).toISOString() : "Possible dead secret"
          }
          warn={row.lastReadAt == null && row.kind === "secret"}
          onClick={onQueryChange ? () => onQueryChange("is:dormant") : undefined}
        />
        <StatusToken
          label="readers"
          value={String(row.readers.length)}
          hint={row.readers.length === 0 ? "No Flow declares a read" : row.readers.join(", ")}
          onClick={
            onQueryChange && row.readers[0]
              ? () => onQueryChange(`reader:${row.readers[0]}`)
              : undefined
          }
        />
        <StatusToken
          label="blast"
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
        {row.sharedFingerprintEnvs.length > 0 ? (
          <StatusToken
            label="shared"
            value={row.sharedFingerprintEnvs.join(", ")}
            hint="Same fingerprint in another environment"
            warn
            onClick={onQueryChange ? () => onQueryChange("is:shared") : undefined}
          />
        ) : null}
      </div>

      <ResolutionPath
        steps={steps}
        selected={selected}
        fill={fill}
        backend={backend}
        onSelect={setLayer}
      />

      <section
        className="shrink-0 border-b border-border/60"
        aria-label="Fingerprints by environment"
      >
        <SectionStrip
          title={row.sensitive ? "Fingerprints" : "Value"}
          meta={row.sensitive ? `${slots.length} env` : env}
        />
        {row.sensitive ? (
          <FingerprintList slots={slots} env={env} />
        ) : (
          <p className="px-2 py-1.5 font-mono text-[12px]" role="status">
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
      <ToolbarTip label="Copy snippets (no secret values)" className="flex self-stretch">
        <DropdownMenuTrigger
          render={(props) => (
            <button
              {...props}
              type="button"
              aria-label="Copy"
              className={EXPLORER_ICON_BUTTON_CLASS}
            >
              <HugeiconsIcon icon={MoreHorizontalCircle01Icon} className="size-3.5" />
            </button>
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
  onRotate,
}: {
  readonly row: VaultRecord;
  readonly env: string;
  readonly postureUnset: boolean;
  readonly blastWarn: boolean;
  readonly blastSummary: string;
  readonly blastDetail: string | null;
  readonly overdue: boolean;
  readonly onSet: () => void;
  readonly onRotate: () => void;
}): JSX.Element | null {
  if (blastWarn) {
    return (
      <section
        className="shrink-0 border-b border-destructive/25 bg-destructive/5"
        aria-label="Rotation blast radius"
        role="alert"
      >
        <div className={cn(EXPLORER_STRIP_CLASS, "border-b-0")}>
          <p className="flex min-w-0 flex-1 items-center px-2 text-[12px] text-destructive">
            {blastSummary}
            {blastDetail ? <span className="text-muted-foreground"> · {blastDetail}</span> : null}
          </p>
        </div>
        {row.blastRadius.runIds.length > 0 ? (
          <ul>
            {row.blastRadius.runIds.map((id) => (
              <li key={id}>
                <Link
                  to="/overview"
                  search={{ run: id }}
                  className={cn(EXPLORER_ROW_CLASS, "text-destructive")}
                >
                  <span className="min-w-0 truncate font-mono text-[11px]">{id}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }
  if (postureUnset) {
    return (
      <section
        className={cn(EXPLORER_STRIP_CLASS, "border-amber-500/25 bg-amber-500/5")}
        aria-label="Unset contract"
        role="status"
      >
        <p className="flex min-w-0 flex-1 items-center px-2 text-[12px] text-amber-900 dark:text-amber-300">
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
        <Button type="button" size="sm" onClick={onSet} className="h-full shrink-0 rounded-none">
          Set
        </Button>
      </section>
    );
  }
  if (overdue && isRotateCadence(row.rotate)) {
    return (
      <section
        className={cn(EXPLORER_STRIP_CLASS, "border-amber-500/25 bg-amber-500/5")}
        aria-label="Rotation overdue"
        role="status"
      >
        <p className="flex min-w-0 flex-1 items-center px-2 text-[12px] text-amber-900 dark:text-amber-300">
          Past rotate {row.rotate}
          <span className="text-muted-foreground"> · blast is clear</span>
        </p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onRotate}
          className="h-full shrink-0 rounded-none"
        >
          Rotate
        </Button>
      </section>
    );
  }
  return null;
}

function SectionStrip({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: string;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <header className={cn(EXPLORER_STRIP_CLASS, "items-center gap-2 px-2")}>
      <h3 className={cn(SECTION_HEAD_CLASS, "shrink-0 leading-none")}>{title}</h3>
      {children}
      {meta ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </header>
  );
}

function StatusToken({
  label,
  value,
  hint,
  warn = false,
  won = false,
  onClick,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly warn?: boolean;
  readonly won?: boolean;
  readonly onClick?: () => void;
}): JSX.Element {
  const className = cn(EXPLORER_STRIP_TOKEN_CLASS, EXPLORER_STRIP_TOKEN_IDLE_CLASS, "gap-1.5");
  const body = (
    <>
      <span className="tracking-[0.08em] uppercase">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums text-foreground",
          warn && "text-amber-800 dark:text-amber-400",
          won && WON_INK,
        )}
      >
        {value}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" title={hint} onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return (
    <span title={hint} className={className}>
      {body}
    </span>
  );
}

function ResolutionPath({
  steps,
  selected,
  fill,
  backend,
  onSelect,
}: {
  readonly steps: readonly VaultResolutionStep[];
  readonly selected: VaultResolutionStep;
  readonly fill: VaultLayerFill;
  readonly backend: VaultBackend | null;
  readonly onSelect: (source: VaultResolutionSource) => void;
}): JSX.Element {
  const winnerIndex = steps.findIndex((s) => s.won);
  return (
    <section className="shrink-0 border-b border-border/60" aria-label="Resolution chain">
      <SectionStrip title="Resolution" meta="first hit wins" />
      <ol className="relative" data-slot="vault-lock-path">
        <span
          className="pointer-events-none absolute top-3 bottom-3 left-[15px] w-px bg-border/60"
          aria-hidden
        />
        {steps.map((step, index) => {
          const active = step.source === selected.source;
          const status = layerStatus(step, index, winnerIndex);
          const afterWin = winnerIndex >= 0 && index > winnerIndex;
          return (
            <li key={step.source}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(step.source)}
                className={cn(
                  EXPLORER_ROW_CLASS,
                  active && EXPLORER_ROW_SELECTED_CLASS,
                  afterWin && !active && "opacity-50",
                )}
              >
                <span
                  className={cn(EXPLORER_RAIL_CLASS, active && EXPLORER_RAIL_ACTIVE_CLASS)}
                  aria-hidden
                />
                <span
                  className={cn(
                    "relative z-10 size-2 shrink-0 rounded-full border",
                    status === "won" && "border-emerald-500 bg-emerald-500",
                    status === "shadowed" && "border-muted-foreground/50 bg-muted-foreground/40",
                    status === "missed" && "border-muted-foreground/50 bg-transparent",
                    status === "skipped" && "border-border bg-transparent",
                  )}
                  aria-hidden
                />
                <HugeiconsIcon
                  icon={SOURCE_ICON[step.source]}
                  className={cn(
                    EXPLORER_ICON_CLASS,
                    status === "won" ? WON_INK : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono",
                    status === "won" ? WON_INK : "text-foreground",
                  )}
                >
                  {SOURCE_SHORT[step.source]}
                  {step.source === "driver" ? (
                    <span className="ml-1.5 font-sans text-[10px] text-muted-foreground">
                      {vaultDriverKind(backend)}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[10px]",
                    status === "won" ? WON_INK : "text-muted-foreground",
                  )}
                >
                  {status}
                </span>
              </button>
              {active ? (
                <div className="flex items-center gap-2 border-b border-border/60 py-1.5 pr-2 pl-8">
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {fill.command}
                  </p>
                  <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground sm:inline">
                    {fill.hint}
                  </span>
                  <CopyInlineButton value={fill.command} label={`Copy ${step.source} fill`} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">
        Winner: {steps.find((s) => s.won)?.source ?? "none"}. {fill.hint}
      </p>
    </section>
  );
}

function FingerprintList({
  slots,
  env,
}: {
  readonly slots: readonly FingerprintSlot[];
  readonly env: string;
}): JSX.Element {
  return (
    <ul data-slot="vault-fingerprints">
      {slots.map((slot) => (
        <li key={slot.env} className={EXPLORER_ROW_CLASS}>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {slot.env}
            {slot.env === env ? (
              <span className="ml-1 text-[10px] text-muted-foreground">this</span>
            ) : null}
          </span>
          {slot.fp ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{slot.fp}</span>
          ) : (
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">—</span>
          )}
          {slot.shared ? (
            <span role="status" className="shrink-0 text-[10px] text-amber-800 dark:text-amber-400">
              matches {env}
            </span>
          ) : null}
          {slot.fp ? (
            <CopyInlineButton value={slot.fp} label={`Copy ${slot.env} fingerprint`} />
          ) : null}
        </li>
      ))}
    </ul>
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
    <section className="shrink-0 border-b border-border/60" aria-label="Readers">
      <SectionStrip title="Readers" meta={String(readers.length)}>
        <code className="min-w-0 truncate font-mono text-[10px] leading-none text-muted-foreground">
          {vaultFxSnippet(name)}
        </code>
      </SectionStrip>
      {readers.length === 0 ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">None declared.</p>
      ) : (
        <ul>
          {readers.map((id) => (
            <li key={id}>
              <div className={cn(EXPLORER_ROW_CLASS, "group/reader")}>
                <HugeiconsIcon
                  icon={ELEMENT_ICONS.flow.icon}
                  className={cn(EXPLORER_ICON_CLASS, "text-sky-500")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
                <div
                  className={cn(
                    EXPLORER_BAND_ACTIONS_CLASS,
                    "group-hover/reader:opacity-100 group-focus-within/reader:opacity-100",
                  )}
                >
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
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Flows
                  </Link>
                  <Link
                    to="/overview"
                    search={{ flow: id }}
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Graph
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
