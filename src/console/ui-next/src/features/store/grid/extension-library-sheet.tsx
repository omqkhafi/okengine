/**
 * Add an external Postgres extension from the Console library.
 */

import { useMemo, useState, type JSX } from "react";
import {
  ArrowLeft01Icon,
  Calendar03Icon,
  Clock01Icon,
  LinkSquare02Icon,
  MapsLocation01Icon,
  PuzzleIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHEET_SEARCH, SheetFooterButton } from "@/components/ui/sheet-form.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { Switch } from "@/components/motion/switch.tsx";
import { cn } from "@/lib/utils.ts";
import { useStoreEdit } from "../data/use-store-edit.ts";
import { CatalogAdvancedToggle } from "./catalog-advanced.tsx";
import {
  extensionInstallAdvancedCount,
  extensionInstallPlan,
  featuredLibraryExtensions,
  groupLibraryExtensions,
  libraryExtensionTitle,
  libraryExtensionVendor,
  pgExtensionUrl,
  PG_EXTENSION_CATEGORY_LABELS,
  PG_FEATURED_LIBRARY_NAMES,
  PG_LIBRARY_CATEGORY_ORDER,
  PG_LIBRARY_EXTENSIONS,
  searchLibraryExtensions,
  type PgExtensionCategory,
  type PgExtensionInfo,
} from "../lib/pg-extension-library.ts";

const FEATURED_ICONS: Record<(typeof PG_FEATURED_LIBRARY_NAMES)[number], ElementHugeIcon> = {
  timescaledb: Clock01Icon,
  pg_cron: Calendar03Icon,
  postgis: MapsLocation01Icon,
};

const CATEGORY_ITEMS = [
  { value: "all", label: "All" },
  ...PG_LIBRARY_CATEGORY_ORDER.map((id) => ({
    value: id,
    label: PG_EXTENSION_CATEGORY_LABELS[id],
  })),
];

/** Props for {@link ExtensionLibrarySheet}. */
export interface ExtensionLibrarySheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly presentNames: readonly string[];
}

/**
 * Browse Timescale / PostGIS / pg_cron and add one to the Extensions catalog.
 *
 * @param props - Store identity + names already listed
 */
export function ExtensionLibrarySheet({
  open,
  onOpenChange,
  storeRef,
  presentNames,
}: ExtensionLibrarySheetProps): JSX.Element {
  const edit = useStoreEdit();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PgExtensionCategory | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<PgExtensionInfo | null>(null);
  const [installTab, setInstallTab] = useState<"extensions" | "sql">("extensions");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [schema, setSchema] = useState("");
  const [version, setVersion] = useState("");
  const [cascade, setCascade] = useState(false);

  const installed = useMemo(() => new Set(presentNames), [presentNames]);
  const filtered = useMemo(() => {
    const searched = searchLibraryExtensions(PG_LIBRARY_EXTENSIONS, query);
    if (category === "all") return searched;
    return searched.filter((ext) => ext.category === category);
  }, [query, category]);
  const browsingAll = category === "all" && query.trim() === "";
  const featured = useMemo(
    () => (browsingAll ? featuredLibraryExtensions(PG_LIBRARY_EXTENSIONS) : []),
    [browsingAll],
  );
  const grid = useMemo(() => {
    if (!browsingAll) return filtered;
    const featuredNames = new Set(featured.map((ext) => ext.name));
    return filtered.filter((ext) => !featuredNames.has(ext.name));
  }, [browsingAll, featured, filtered]);
  const groups = useMemo(() => groupLibraryExtensions(grid), [grid]);

  const installOptions = useMemo(
    () => ({
      ...(schema.trim() !== "" ? { schema: schema.trim() } : {}),
      ...(version.trim() !== "" ? { version: version.trim() } : {}),
      ...(cascade ? { cascade: true } : {}),
    }),
    [schema, version, cascade],
  );
  const plan = useMemo(
    () => (reviewing ? extensionInstallPlan(reviewing, installed, installOptions) : null),
    [reviewing, installed, installOptions],
  );

  const beginInstall = (ext: PgExtensionInfo): void => {
    if (installed.has(ext.name)) return;
    setError(null);
    setInstallTab("extensions");
    setAdvancedOpen(false);
    setSchema("");
    setVersion("");
    setCascade(false);
    setReviewing(ext);
  };

  const confirmInstall = async (): Promise<void> => {
    if (!reviewing || !plan) return;
    const names = plan.items.filter((item) => !item.already).map((item) => item.name);
    if (names.length === 0) {
      setReviewing(null);
      return;
    }
    setError(null);
    setPendingName(reviewing.name);
    try {
      for (const name of names) {
        await edit.mutateAsync({
          ref: storeRef,
          child: "extensions",
          id: name,
          patch: {
            enabled: true,
            ...(name === reviewing.name ? installOptions : {}),
          },
          commit: true,
        });
      }
      setReviewing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingName(null);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setCategory("all");
          setError(null);
          setPendingName(null);
          setReviewing(null);
          setInstallTab("extensions");
          setAdvancedOpen(false);
          setSchema("");
          setVersion("");
          setCascade(false);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-3xl"
        data-slot="extension-library-sheet"
      >
        {reviewing && plan ? (
          <InstallReview
            ext={reviewing}
            plan={plan}
            tab={installTab}
            advancedOpen={advancedOpen}
            extraCount={extensionInstallAdvancedCount(installOptions)}
            schema={schema}
            version={version}
            cascade={cascade}
            error={error}
            pending={pendingName !== null}
            onTab={setInstallTab}
            onAdvanced={setAdvancedOpen}
            onSchema={setSchema}
            onVersion={setVersion}
            onCascade={setCascade}
            onBack={() => {
              setReviewing(null);
              setError(null);
            }}
            onConfirm={() => void confirmInstall()}
          />
        ) : (
          <>
            <SheetHeader className="gap-1 border-b border-border/50">
              <div className="flex items-baseline justify-between gap-3 pr-8">
                <SheetTitle className="text-sm">Extend this store</SheetTitle>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {filtered.length} pack{filtered.length === 1 ? "" : "s"}
                  {query.trim() ? ` matching “${query.trim()}”` : ""}
                </p>
              </div>
              <SheetDescription className="text-[11px]">
                External packs — Timescale, PostGIS, cron, FDWs. Install reviews{" "}
                <span className="font-mono">CREATE EXTENSION</span> first.
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center border-b border-border/50">
                <div className="relative min-w-0 flex-1">
                  <HugeiconsIcon
                    icon={Search01Icon}
                    className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search packs…"
                    aria-label="Search library"
                    flat
                    className={cn(SHEET_SEARCH, "font-mono")}
                    autoFocus
                  />
                </div>
                <Select
                  items={CATEGORY_ITEMS}
                  value={category}
                  onValueChange={(value) => {
                    if (value == null || Array.isArray(value)) return;
                    setCategory(value === "all" ? "all" : (value as PgExtensionCategory));
                  }}
                >
                  <SelectTrigger
                    aria-label="Category"
                    size="sm"
                    className="h-8 shrink-0 gap-1 border-0 bg-transparent px-1.5 shadow-none ring-0 text-[11px] dark:bg-transparent dark:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3.5"
                  >
                    <SelectValue>
                      {(raw) => {
                        const id = String(raw ?? "all");
                        const label =
                          id === "all"
                            ? "All"
                            : PG_EXTENSION_CATEGORY_LABELS[id as PgExtensionCategory];
                        return <span>Category · {label}</span>;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false} className="min-w-44">
                    <SelectGroup>
                      {CATEGORY_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value} className="text-[11px]">
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {error ? (
                <p
                  className="border-b border-border/50 px-4 py-2 text-[11px] text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                    No matching packs.
                  </p>
                ) : (
                  <div className="flex flex-col gap-5 px-4 py-4">
                    {featured.length > 0 ? (
                      <section className="flex flex-col gap-2">
                        <SectionLabel>Popular</SectionLabel>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {featured.map((ext) => (
                            <FeaturedCard
                              key={ext.name}
                              ext={ext}
                              installed={installed.has(ext.name)}
                              pending={pendingName === ext.name}
                              disabled={pendingName !== null}
                              onAdd={() => beginInstall(ext)}
                            />
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {groups.map((group) => (
                      <section key={group.category} className="flex flex-col gap-2">
                        <SectionLabel>{group.label}</SectionLabel>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {group.items.map((ext) => (
                            <LibraryCard
                              key={ext.name}
                              ext={ext}
                              installed={installed.has(ext.name)}
                              pending={pendingName === ext.name}
                              disabled={pendingName !== null}
                              onAdd={() => beginInstall(ext)}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InstallReview({
  ext,
  plan,
  tab,
  advancedOpen,
  extraCount,
  schema,
  version,
  cascade,
  error,
  pending,
  onTab,
  onAdvanced,
  onSchema,
  onVersion,
  onCascade,
  onBack,
  onConfirm,
}: {
  readonly ext: PgExtensionInfo;
  readonly plan: ReturnType<typeof extensionInstallPlan>;
  readonly tab: "extensions" | "sql";
  readonly advancedOpen: boolean;
  readonly extraCount: number;
  readonly schema: string;
  readonly version: string;
  readonly cascade: boolean;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onTab: (tab: "extensions" | "sql") => void;
  readonly onAdvanced: (open: boolean) => void;
  readonly onSchema: (schema: string) => void;
  readonly onVersion: (version: string) => void;
  readonly onCascade: (cascade: boolean) => void;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}): JSX.Element {
  const title = libraryExtensionTitle(ext.name);
  const icon =
    ext.name === "timescaledb" || ext.name === "pg_cron" || ext.name === "postgis"
      ? FEATURED_ICONS[ext.name]
      : PuzzleIcon;
  return (
    <>
      <SheetHeader className="gap-2 border-b border-border/50">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" />
          Library
        </button>
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-full border border-border/50 bg-muted/20">
            <HugeiconsIcon icon={icon} className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <SheetTitle className="text-sm">Install {title}</SheetTitle>
            <SheetDescription className="text-[11px]">
              Review and configure this pack
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <p className="text-[11px] font-medium text-foreground">Installs</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          What this pack will run on the store
        </p>
        <div className="mt-3 flex items-center gap-4" role="tablist" aria-label="Install preview">
          <InstallTab active={tab === "extensions"} onClick={() => onTab("extensions")}>
            Extensions
          </InstallTab>
          <InstallTab active={tab === "sql"} onClick={() => onTab("sql")}>
            SQL
          </InstallTab>
        </div>
        {tab === "extensions" ? (
          <ul className="mt-3 divide-y divide-border/50 rounded-lg border border-border/50">
            {plan.items.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="font-mono text-[12px] text-foreground">{item.name}</span>
                {item.already ? (
                  <InstalledBadge />
                ) : (
                  <Badge
                    variant="outline"
                    className="h-5 rounded-md border-amber-500/40 bg-amber-500/10 px-1.5 text-[9px] font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-400"
                  >
                    Required
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border/50 bg-muted/15 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground">
            {plan.sql}
          </pre>
        )}
        {plan.note ? (
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{plan.note}</p>
        ) : null}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Options
          </span>
          <CatalogAdvancedToggle
            open={advancedOpen}
            extraCount={extraCount}
            onOpenChange={onAdvanced}
            controls="sql-extension-advanced"
          />
        </div>
        {advancedOpen ? (
          <div id="sql-extension-advanced" className="mt-3 flex flex-col gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Schema
              </span>
              <Input
                value={schema}
                onChange={(event) => onSchema(event.target.value)}
                placeholder="engine default"
                className="h-8 font-mono text-[12px]"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Version
              </span>
              <Input
                value={version}
                onChange={(event) => onVersion(event.target.value)}
                placeholder="packaged default"
                className="h-8 font-mono text-[12px]"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-foreground">CASCADE</span>
              <Switch
                size="sm"
                checked={cascade}
                onCheckedChange={onCascade}
                ariaLabel="CASCADE required extensions"
              />
            </label>
            <p className="text-[11px] leading-snug text-muted-foreground">
              `pg_catalog` is refused. Schema and version apply to this pack only.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="mt-3 text-[11px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <SheetFooter>
        <SheetFooterButton split onClick={onBack}>
          Cancel
        </SheetFooterButton>
        <SheetFooterButton
          variant="default"
          disabled={pending}
          data-slot="extension-library-install"
          data-name={ext.name}
          onClick={onConfirm}
        >
          {pending ? "Installing…" : "Install pack"}
        </SheetFooterButton>
      </SheetFooter>
    </>
  );
}

function InstallTab({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors hover:bg-muted/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function LibraryTitle({
  name,
  title,
  className,
}: {
  readonly name: string;
  readonly title: string;
  readonly className?: string;
}): JSX.Element {
  const url = pgExtensionUrl(name);
  if (!url) {
    return <p className={cn("font-medium tracking-tight text-foreground", className)}>{title}</p>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group/ext-link inline-flex max-w-full items-center gap-1 font-medium tracking-tight text-foreground underline-offset-2 hover:underline",
        className,
      )}
    >
      <span className="truncate">{title}</span>
      <HugeiconsIcon
        icon={LinkSquare02Icon}
        className="size-3 shrink-0 text-muted-foreground/50 group-hover/ext-link:text-muted-foreground"
        aria-hidden
      />
    </a>
  );
}

function SectionLabel({ children }: { readonly children: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {children}
      </p>
      <div className="h-px min-w-0 flex-1 bg-border/50" aria-hidden />
    </div>
  );
}

function FeaturedCard({
  ext,
  installed,
  pending,
  disabled,
  onAdd,
}: {
  readonly ext: PgExtensionInfo;
  readonly installed: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onAdd: () => void;
}): JSX.Element {
  const name = ext.name as (typeof PG_FEATURED_LIBRARY_NAMES)[number];
  const title = libraryExtensionTitle(ext.name);
  const vendor = libraryExtensionVendor(ext.name);
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/10 p-3">
      <div className="flex size-8 items-center justify-center rounded-lg border border-border/40 bg-background">
        <HugeiconsIcon icon={FEATURED_ICONS[name]} className="size-4 text-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <LibraryTitle name={ext.name} title={title} className="text-[13px]" />
        <p className="font-mono text-[11px] text-muted-foreground">{ext.name}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{ext.comment}</p>
        <KeyTags tags={ext.tags} />
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {PG_EXTENSION_CATEGORY_LABELS[ext.category]}
          </p>
          {vendor ? (
            <p className="truncate text-[10px] text-muted-foreground/80">Built by {vendor}</p>
          ) : null}
        </div>
        <AddOrInstalled
          installed={installed}
          pending={pending}
          disabled={disabled}
          name={ext.name}
          onAdd={onAdd}
        />
      </div>
    </li>
  );
}

function LibraryCard({
  ext,
  installed,
  pending,
  disabled,
  onAdd,
}: {
  readonly ext: PgExtensionInfo;
  readonly installed: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onAdd: () => void;
}): JSX.Element {
  const vendor = libraryExtensionVendor(ext.name);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border/50 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <LibraryTitle
            name={ext.name}
            title={libraryExtensionTitle(ext.name)}
            className="text-[13px]"
          />
          <p className="font-mono text-[11px] text-muted-foreground">{ext.name}</p>
          <KeyTags tags={ext.tags} />
        </div>
        {installed ? <InstalledBadge /> : null}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{ext.comment}</p>
      {ext.requires && ext.requires.length > 0 ? (
        <p className="font-mono text-[10px] text-muted-foreground/80">
          needs {ext.requires.join(" + ")}
        </p>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {PG_EXTENSION_CATEGORY_LABELS[ext.category]}
          </p>
          {vendor ? (
            <p className="truncate text-[10px] text-muted-foreground/80">Built by {vendor}</p>
          ) : null}
        </div>
        {installed ? null : (
          <AddOrInstalled
            installed={false}
            pending={pending}
            disabled={disabled}
            name={ext.name}
            onAdd={onAdd}
          />
        )}
      </div>
    </li>
  );
}

function KeyTags({ tags }: { readonly tags: readonly string[] | undefined }): JSX.Element | null {
  if (!tags || tags.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, 4).map((tag) => (
        <span
          key={tag}
          className="rounded border border-border/40 px-1 py-px font-mono text-[9px] text-muted-foreground/80"
        >
          {tag}
        </span>
      ))}
    </p>
  );
}

function InstalledBadge(): JSX.Element {
  return (
    <Badge
      variant="outline"
      className="h-5 rounded-md border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[9px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400"
    >
      Installed
    </Badge>
  );
}

function AddOrInstalled({
  installed,
  pending,
  disabled,
  name,
  onAdd,
}: {
  readonly installed: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly name: string;
  readonly onAdd: () => void;
}): JSX.Element {
  if (installed) return <InstalledBadge />;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 shrink-0 px-2 text-[11px]"
      disabled={disabled}
      data-slot="extension-library-add"
      data-name={name}
      onClick={onAdd}
    >
      {pending ? "Installing…" : "Install"}
    </Button>
  );
}
