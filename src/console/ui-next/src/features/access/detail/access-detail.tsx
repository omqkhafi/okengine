/**
 * Access key inspector — grant, bounds, usage, working call.
 */

import { CrownIcon, Key01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, type JSX, type ReactNode } from "react";
import type { AccessKeyBlastPayload, AccessKeyRow } from "@/client.ts";
import { CopyInlineButton } from "@/components/explorer/copy-inline-button.tsx";
import { DetailHeader } from "@/components/explorer/detail-header.tsx";
import {
  EXPLORER_COUNT_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  SECTION_HEAD_CLASS,
  explorerIconInk,
} from "@/components/explorer/explorer-chrome.ts";
import { Button } from "@/components/ui/button";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { httpMethodBadgeClass, httpMethodRailClass } from "@/features/flows/traces/http-method.ts";
import { cn } from "@/lib/utils.ts";
import {
  classifyAccessAllowEntry,
  formatAccessExpiry,
  formatAccessWhen,
} from "../lib/format-when.ts";
import { groupAccessScopes } from "../lib/scope-groups.ts";

const CALL_REQUEST = `GET /secure
Authorization: Bearer <secret>`;
const CALL_RESPONSE = `{ "ok": true }`;

/** Props for {@link AccessDetail}. */
export interface AccessDetailProps {
  readonly keyRow: AccessKeyRow;
  readonly blast: AccessKeyBlastPayload | undefined;
  readonly now: number;
  readonly leading?: ReactNode;
  readonly onEdit: () => void;
  readonly onRefresh: () => void;
  readonly onRevoke: () => void;
  readonly onRotate: () => void;
  readonly rotatePending: boolean;
}

/**
 * Right-pane key inspector.
 *
 * @param props - Selected key + actions
 */
export function AccessDetail({
  keyRow: row,
  blast,
  now,
  leading,
  onEdit,
  onRefresh,
  onRevoke,
  onRotate,
  rotatePending,
}: AccessDetailProps): JSX.Element {
  const revoked = row.revokedAt !== null;
  const expired = row.expiresAt !== null && row.expiresAt <= now;
  const lastUsed = blast?.lastUsedAt ?? row.lastUsedAt;
  const calls = blast?.callVolume ?? 0;
  const expiry = formatAccessExpiry(row.expiresAt, now);
  const used = formatAccessWhen(lastUsed, now);
  const rate = row.rateLimit ? `${row.rateLimit.max} / ${row.rateLimit.per}` : "none";
  const groups = useMemo(() => groupAccessScopes(row.scopes), [row.scopes]);
  const ceiling = row.creatorScopes.length;
  const attenuated = ceiling > 0 && row.scopes.length < ceiling;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto"
      data-slot="access-detail"
      aria-label="Access key detail"
      aria-live="polite"
    >
      <DetailHeader
        dataSlot="access-detail-header"
        leading={leading}
        icon={<HugeiconsIcon icon={Key01Icon} className="size-4" />}
        title={row.name}
        badge={
          <>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              <HugeiconsIcon
                icon={row.plane === "operator" ? CrownIcon : UserIcon}
                className="size-3"
                aria-hidden
              />
              {row.plane}
            </span>
            {revoked ? (
              <span className="font-mono text-[10px] text-destructive">revoked</span>
            ) : null}
            {expired && !revoked ? (
              <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
                expired
              </span>
            ) : null}
            {row.unused90d && !revoked && !expired ? (
              <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
                unused
              </span>
            ) : null}
          </>
        }
        subtitle={
          <>
            <code className="min-w-0 truncate font-mono text-[11px] leading-none text-foreground/80">
              {row.id}
            </code>
            <CopyInlineButton value={row.id} label={`Copy ${row.id}`} />
          </>
        }
        actions={
          <>
            <ToolbarTip label="Rename or re-attenuate scopes" className="flex self-stretch">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-full rounded-none"
                disabled={revoked}
                onClick={onEdit}
              >
                Edit
              </Button>
            </ToolbarTip>
            <ToolbarTip
              label="Reset expiry from now. The secret stays the same."
              className="flex self-stretch"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-full rounded-none"
                data-slot="access-refresh"
                disabled={revoked}
                onClick={onRefresh}
              >
                Refresh
              </Button>
            </ToolbarTip>
            <ToolbarTip
              label="Mint a new secret. The current secret stops working after residual TTL."
              className="flex self-stretch"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-full rounded-none"
                disabled={rotatePending || revoked}
                onClick={onRotate}
              >
                Rotate
              </Button>
            </ToolbarTip>
            <ToolbarTip
              label="Irreversible. Residual sessions may continue for the access TTL."
              className="flex self-stretch"
            >
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-full rounded-none"
                disabled={revoked}
                onClick={onRevoke}
              >
                Revoke
              </Button>
            </ToolbarTip>
          </>
        }
      />

      <PostureBanner
        revoked={revoked}
        expired={expired}
        unused={row.unused90d}
        residual={blast?.residualAccessNote}
      />

      <div
        className={EXPLORER_STRIP_CLASS}
        data-slot="access-briefing"
        role="group"
        aria-label="Usage"
      >
        <StatusToken label="calls" value={String(calls)} />
        <StatusToken
          label="used"
          value={used}
          hint={lastUsed ? new Date(lastUsed).toISOString() : "No recorded call"}
          warn={lastUsed == null && !revoked}
        />
        <StatusToken
          label="expires"
          value={expiry}
          hint={row.expiresAt ? new Date(row.expiresAt).toISOString() : "No expiry"}
          warn={expired && !revoked}
        />
        <StatusToken label="rate" value={rate} />
      </div>

      <section className="shrink-0 border-b border-border/60" aria-label="Scopes">
        <SectionStrip
          title="Scopes"
          meta={attenuated ? `${row.scopes.length} of ${ceiling}` : String(row.scopes.length)}
        >
          {row.scopes.length > 0 ? (
            <CopyInlineButton value={row.scopes.join("\n")} label="Copy scopes" />
          ) : null}
        </SectionStrip>
        {groups.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No scopes granted.</p>
        ) : (
          <ul data-slot="access-scopes">
            {groups.map((band) => (
              <li key={band.group} className={EXPLORER_ROW_CLASS} aria-label={band.group}>
                <span className={cn(SECTION_HEAD_CLASS, "w-[5.5rem] shrink-0")}>{band.group}</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                  {band.items.map((item) => (
                    <span
                      key={item.scope}
                      title={item.scope}
                      className="font-mono text-[11px] text-foreground"
                    >
                      {item.action}
                    </span>
                  ))}
                </div>
                <HoverCopy
                  value={band.items.map((item) => item.scope).join("\n")}
                  label={`Copy ${band.group} scopes`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="shrink-0 border-b border-border/60" aria-label="Key">
        <SectionStrip title="Key" />
        <dl data-slot="access-key-facts">
          <FactRow
            label="Issuer"
            value={row.creatorId}
            copy={row.creatorId}
            copyLabel={`Copy ${row.creatorId}`}
          />
          <FactRow
            label="Created"
            value={formatAccessWhen(row.createdAt, now)}
            hint={new Date(row.createdAt).toISOString()}
          />
          <FactRow
            label="Expires"
            value={expiry}
            hint={row.expiresAt ? new Date(row.expiresAt).toISOString() : undefined}
            warn={expired && !revoked}
          />
          <FactRow label="Rate" value={rate} />
        </dl>
      </section>

      <AllowSection entries={row.ipAllowlist} />

      <UsageSection
        sourceAddresses={blast?.sourceAddresses ?? []}
        residual={blast?.residualAccessNote}
        lastUsed={lastUsed}
        now={now}
      />

      <CallExample scopes={row.scopes} />
    </div>
  );
}

function PostureBanner({
  revoked,
  expired,
  unused,
  residual,
}: {
  readonly revoked: boolean;
  readonly expired: boolean;
  readonly unused: boolean;
  readonly residual: string | undefined;
}): JSX.Element | null {
  if (revoked) {
    return (
      <section
        className={cn(EXPLORER_STRIP_CLASS, "border-destructive/25 bg-destructive/5")}
        aria-label="Revoked"
        role="status"
      >
        <p className="flex min-w-0 flex-1 items-center px-2 text-[12px] text-destructive">
          Revoked
          <span className="text-muted-foreground">
            {" "}
            · {residual ?? "This secret no longer authenticates."}
          </span>
        </p>
      </section>
    );
  }
  if (expired) {
    return (
      <section
        className={cn(EXPLORER_STRIP_CLASS, "border-amber-500/25 bg-amber-500/5")}
        aria-label="Expired"
        role="status"
      >
        <p className="flex min-w-0 flex-1 items-center px-2 text-[12px] text-amber-900 dark:text-amber-300">
          Expired
          {residual ? <span className="text-muted-foreground"> · {residual}</span> : null}
        </p>
      </section>
    );
  }
  if (unused) {
    return (
      <section
        className={cn(EXPLORER_STRIP_CLASS, "border-amber-500/25 bg-amber-500/5")}
        aria-label="Unused"
        role="status"
      >
        <p className="flex min-w-0 flex-1 items-center px-2 text-[12px] text-amber-900 dark:text-amber-300">
          No calls in 90 days
          <span className="text-muted-foreground"> · rotate or revoke</span>
        </p>
      </section>
    );
  }
  return null;
}

function AllowSection({ entries }: { readonly entries: readonly string[] }): JSX.Element {
  return (
    <section className="shrink-0 border-b border-border/60" aria-label="Allow">
      <SectionStrip title="Allow" meta={entries.length > 0 ? String(entries.length) : "any"} />
      {entries.length === 0 ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">Any origin.</p>
      ) : (
        <ul data-slot="access-allow">
          {entries.map((entry) => {
            const kind = classifyAccessAllowEntry(entry);
            return (
              <li key={entry} className={EXPLORER_ROW_CLASS}>
                <span className={cn(SECTION_HEAD_CLASS, "w-[5.5rem] shrink-0")}>
                  {kind === "ip" ? "IP" : kind === "host" ? "Host" : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{entry}</span>
                <HoverCopy value={entry} label={`Copy ${entry}`} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function UsageSection({
  sourceAddresses,
  residual,
  lastUsed,
  now,
}: {
  readonly sourceAddresses: readonly string[];
  readonly residual: string | undefined;
  readonly lastUsed: number | null;
  readonly now: number;
}): JSX.Element {
  return (
    <section className="shrink-0 border-b border-border/60" aria-label="Usage">
      <SectionStrip title="Usage" meta={lastUsed ? formatAccessWhen(lastUsed, now) : "never"} />
      {sourceAddresses.length === 0 ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No observed source IPs.</p>
      ) : (
        <ul data-slot="access-sources">
          {sourceAddresses.map((ip) => (
            <li key={ip} className={EXPLORER_ROW_CLASS}>
              <span className={cn(SECTION_HEAD_CLASS, "w-[5.5rem] shrink-0")}>IP</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{ip}</span>
              <HoverCopy value={ip} label={`Copy ${ip}`} />
            </li>
          ))}
        </ul>
      )}
      {residual ? (
        <p className="border-t border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground">
          {residual}
        </p>
      ) : null}
    </section>
  );
}

function CallExample({ scopes }: { readonly scopes: readonly string[] }): JSX.Element {
  return (
    <section data-slot="access-call-example">
      <SectionStrip title="Request">
        <CopyInlineButton value={CALL_REQUEST} label="Copy request" />
      </SectionStrip>
      <div className="flex min-w-0 border-b border-border/60">
        <div className={cn("w-1 shrink-0 self-stretch", httpMethodRailClass("GET"))} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase",
                explorerIconInk(httpMethodBadgeClass("GET")),
              )}
            >
              GET
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground select-all">
              /secure
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 border-t border-border/60 px-2.5 py-2">
            <span className="w-[7.5rem] shrink-0 truncate font-mono text-[11px] font-medium text-sky-600 dark:text-sky-400">
              Authorization
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              Bearer &lt;secret&gt;
            </span>
          </div>
        </div>
      </div>

      <SectionStrip title="Response">
        <CopyInlineButton value={CALL_RESPONSE} label="Copy response" />
      </SectionStrip>
      <div className="flex min-w-0 border-b border-border/60">
        <div className="w-1 shrink-0 self-stretch bg-emerald-500" aria-hidden />
        <p className="min-w-0 flex-1 px-2.5 py-2 font-mono text-[11px] text-foreground/80 select-all">
          {CALL_RESPONSE}
        </p>
      </div>
      <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
        Seed the Bearer secret from create / rotate. The key is the issuer; gates see{" "}
        {scopes.join(", ") || "its scopes"}.
      </p>
    </section>
  );
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
      {meta ? (
        <span className={cn(EXPLORER_COUNT_CLASS, !children && "ml-auto")}>{meta}</span>
      ) : null}
      {children ? <div className="ml-auto flex items-center">{children}</div> : null}
    </header>
  );
}

function StatusToken({
  label,
  value,
  hint,
  warn = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly warn?: boolean;
}): JSX.Element {
  return (
    <span
      title={hint}
      className={cn(EXPLORER_STRIP_TOKEN_CLASS, EXPLORER_STRIP_TOKEN_IDLE_CLASS, "gap-1.5")}
    >
      <span className="tracking-[0.08em] uppercase">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums text-foreground",
          warn && "text-amber-800 dark:text-amber-400",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function HoverCopy({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}): JSX.Element {
  return (
    <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <CopyInlineButton value={value} label={label} />
    </div>
  );
}

function FactRow({
  label,
  value,
  hint,
  copy,
  copyLabel,
  warn = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly copy?: string;
  readonly copyLabel?: string;
  readonly warn?: boolean;
}): JSX.Element {
  return (
    <div className={EXPLORER_ROW_CLASS}>
      <dt className={cn(SECTION_HEAD_CLASS, "w-[5.5rem] shrink-0")}>{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[11px]",
          warn && "text-amber-800 dark:text-amber-400",
        )}
        title={hint}
      >
        {value}
      </dd>
      {copy ? <HoverCopy value={copy} label={copyLabel ?? `Copy ${label}`} /> : null}
    </div>
  );
}
