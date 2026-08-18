/**
 * Pure Manifest Diff engine (Console §9.12).
 *
 * Classifies every behavioural change into exactly one of:
 *   contract-breaking · permission-widening · effect-widening · no-impact
 *
 * No I/O. Suitable for the Console panel and the CI gate.
 */

import type {
  Ai,
  AiAgent,
  AiPrompt,
  Channel,
  Clock,
  DiffCategory,
  Effects,
  Flow,
  FlowErrors,
  Gate,
  I18n,
  Journey,
  JsonSchema,
  Manifest,
  ManifestChange,
  ManifestDiffResult,
  Plugin,
  SecretContract,
  Signal,
  Slo,
  Store,
  Table,
  Tenancy,
  Trigger,
} from "./types.ts";

const CATEGORY_RANK: Record<DiffCategory, number> = {
  "contract-breaking": 3,
  "permission-widening": 2,
  "effect-widening": 1,
  "no-impact": 0,
};

const EFFECT_KEYS = ["reads", "writes", "emits", "sends", "asks", "secrets", "calls"] as const;

/** Isolation strength: higher = stronger tenant separation. */
const ISOLATION_RANK: Record<string, number> = {
  row: 1,
  schema: 2,
  database: 3,
};

/**
 * Diff two manifests and classify every behavioural change.
 */
export function diffManifest(before: Manifest, after: Manifest): ManifestDiffResult {
  const changes: ManifestChange[] = [];

  if (before.app !== after.app) {
    changes.push(
      change(
        "/app",
        "contract-breaking",
        "changed",
        before.app,
        after.app,
        `app identity changed: ${before.app} → ${after.app}`,
      ),
    );
  }

  if (before.oke !== after.oke) {
    changes.push(
      change(
        "/oke",
        "contract-breaking",
        "changed",
        before.oke,
        after.oke,
        `manifest schema version changed: ${before.oke} → ${after.oke}`,
      ),
    );
  }

  diffRecord(before.flows, after.flows, "/flows", diffFlow, changes);
  diffRecord(before.signals, after.signals, "/signals", diffSignal, changes);
  diffRecord(before.stores, after.stores, "/stores", diffStore, changes);
  diffRecord(before.clocks, after.clocks, "/clocks", diffClock, changes);
  diffRecord(
    before.gates,
    after.gates,
    "/gates",
    diffGateDef,
    changes,
    "permission-widening",
    "no-impact",
  );
  diffRecord(before.vault, after.vault, "/vault", diffSecret, changes);
  diffRecord(before.channels, after.channels, "/channels", diffChannel, changes);
  diffRecord(before.plugins, after.plugins, "/plugins", diffPlugin, changes);
  diffRecord(before.journeys, after.journeys, "/journeys", diffJourney, changes);
  diffAi(before.ai, after.ai, changes);
  diffDrivers(before.drivers, after.drivers, changes);
  diffTenancy(before.tenancy, after.tenancy, changes);
  diffI18n(before.i18n, after.i18n, changes);
  diffTopology(before.topology, after.topology, changes);
  diffImages(before.images, after.images, changes);

  return { changes, severity: highestSeverity(changes) };
}

/**
 * Highest blast-radius category among changes, or `null` if none.
 */
export function highestSeverity(changes: readonly ManifestChange[]): DiffCategory | null {
  let best: DiffCategory | null = null;
  for (const c of changes) {
    if (best === null || CATEGORY_RANK[c.category] > CATEGORY_RANK[best]) {
      best = c.category;
    }
  }
  return best;
}

function change(
  path: string,
  category: DiffCategory,
  kind: ManifestChange["kind"],
  before: unknown,
  after: unknown,
  summary: string,
): ManifestChange {
  const entry: ManifestChange = { path, category, kind, summary };
  if (before !== undefined) entry.before = before;
  if (after !== undefined) entry.after = after;
  return entry;
}

function diffRecord<T>(
  before: Record<string, T> | undefined,
  after: Record<string, T> | undefined,
  base: string,
  compare: (b: T, a: T, path: string, out: ManifestChange[]) => void,
  out: ManifestChange[],
  removedCategory: DiffCategory = "contract-breaking",
  addedCategory: DiffCategory = "no-impact",
): void {
  const bKeys = new Set(Object.keys(before ?? {}));
  const aKeys = new Set(Object.keys(after ?? {}));

  for (const key of sorted(bKeys)) {
    const path = `${base}/${escape(key)}`;
    if (!aKeys.has(key)) {
      out.push(
        change(path, removedCategory, "removed", before![key], undefined, `removed ${path}`),
      );
      continue;
    }
    compare(before![key]!, after![key]!, path, out);
  }

  for (const key of sorted(aKeys)) {
    if (bKeys.has(key)) continue;
    const path = `${base}/${escape(key)}`;
    out.push(change(path, addedCategory, "added", undefined, after![key], `added ${path}`));
  }
}

function diffFlow(before: Flow, after: Flow, path: string, out: ManifestChange[]): void {
  diffTrigger(before.trigger, after.trigger, `${path}/trigger`, out);
  diffGatesList(before.gates, after.gates, `${path}/gates`, out);
  diffContractSchema(before.in, after.in, `${path}/in`, "in", out);
  diffContractSchema(before.out, after.out, `${path}/out`, "out", out);
  diffErrors(before.errors, after.errors, `${path}/errors`, out);
  diffEffects(before.effects, after.effects, `${path}/effects`, out);
  diffSlo(before.slo, after.slo, `${path}/slo`, out);

  if (before.plane !== after.plane && (before.plane !== undefined || after.plane !== undefined)) {
    let category: DiffCategory = "contract-breaking";
    if (before.plane === "operator" && after.plane === "user") {
      category = "permission-widening";
    } else if (after.plane === undefined) {
      category = "no-impact";
    }
    out.push(
      change(
        `${path}/plane`,
        category,
        kindOf(before.plane, after.plane),
        before.plane,
        after.plane,
        `plane ${before.plane ?? "∅"} → ${after.plane ?? "∅"}`,
      ),
    );
  }

  if (
    before.durable !== after.durable &&
    (before.durable !== undefined || after.durable !== undefined)
  ) {
    out.push(
      change(
        `${path}/durable`,
        after.durable === true
          ? "effect-widening"
          : before.durable === true
            ? "contract-breaking"
            : "no-impact",
        kindOf(before.durable, after.durable),
        before.durable,
        after.durable,
        `durable ${String(before.durable)} → ${String(after.durable)}`,
      ),
    );
  }

  if (before.live !== after.live && (before.live !== undefined || after.live !== undefined)) {
    out.push(
      change(
        `${path}/live`,
        after.live === true ? "effect-widening" : "no-impact",
        kindOf(before.live, after.live),
        before.live,
        after.live,
        `live ${String(before.live)} → ${String(after.live)}`,
      ),
    );
  }

  if (!deepEqual(before.cache, after.cache)) {
    out.push(
      change(
        `${path}/cache`,
        "no-impact",
        kindOf(before.cache, after.cache),
        before.cache,
        after.cache,
        "cache policy changed",
      ),
    );
  }

  if (
    before.cacheKeys !== after.cacheKeys &&
    (before.cacheKeys !== undefined || after.cacheKeys !== undefined)
  ) {
    out.push(
      change(
        `${path}/cacheKeys`,
        "no-impact",
        kindOf(before.cacheKeys, after.cacheKeys),
        before.cacheKeys,
        after.cacheKeys,
        "cacheKeys changed",
      ),
    );
  }

  if (
    before.source !== after.source &&
    (before.source !== undefined || after.source !== undefined)
  ) {
    out.push(
      change(
        `${path}/source`,
        "no-impact",
        kindOf(before.source, after.source),
        before.source,
        after.source,
        "source location changed",
      ),
    );
  }

  if (!deepEqual(before.deprecated, after.deprecated)) {
    out.push(
      change(
        `${path}/deprecated`,
        "no-impact",
        kindOf(before.deprecated, after.deprecated),
        before.deprecated,
        after.deprecated,
        "deprecation marker changed",
      ),
    );
  }

  if (!setEqual(before.steps, after.steps)) {
    const added = setDiff(after.steps, before.steps);
    const removed = setDiff(before.steps, after.steps);
    if (removed.length > 0) {
      out.push(
        change(
          `${path}/steps`,
          "contract-breaking",
          "changed",
          before.steps,
          after.steps,
          `removed durable steps: ${removed.join(", ")}`,
        ),
      );
    } else if (added.length > 0) {
      out.push(
        change(
          `${path}/steps`,
          "effect-widening",
          "changed",
          before.steps,
          after.steps,
          `added durable steps: ${added.join(", ")}`,
        ),
      );
    }
  }

  if (before.nondeterministic !== after.nondeterministic) {
    if (after.nondeterministic === true) {
      out.push(
        change(
          `${path}/nondeterministic`,
          "effect-widening",
          kindOf(before.nondeterministic, after.nondeterministic),
          before.nondeterministic,
          after.nondeterministic,
          "flow became nondeterministic",
        ),
      );
    } else if (before.nondeterministic === true) {
      out.push(
        change(
          `${path}/nondeterministic`,
          "no-impact",
          kindOf(before.nondeterministic, after.nondeterministic),
          before.nondeterministic,
          after.nondeterministic,
          "flow no longer marked nondeterministic",
        ),
      );
    }
  }

  if (!deepEqual(before.cost, after.cost)) {
    const beforeBudget = before.cost?.budget ?? before.cost?.estimatePerCall ?? 0;
    const afterBudget = after.cost?.budget ?? after.cost?.estimatePerCall ?? 0;
    out.push(
      change(
        `${path}/cost`,
        afterBudget > beforeBudget ? "effect-widening" : "no-impact",
        kindOf(before.cost, after.cost),
        before.cost,
        after.cost,
        "cost declaration changed",
      ),
    );
  }

  if (before.pii !== after.pii && (before.pii !== undefined || after.pii !== undefined)) {
    const category: DiffCategory =
      after.pii === "allow" || (before.pii === "denied" && after.pii === "masked")
        ? "permission-widening"
        : "no-impact";
    out.push(
      change(
        `${path}/pii`,
        category,
        kindOf(before.pii, after.pii),
        before.pii,
        after.pii,
        `pii ${before.pii ?? "∅"} → ${after.pii ?? "∅"}`,
      ),
    );
  }

  if (before.breaking !== after.breaking) {
    out.push(
      change(
        `${path}/breaking`,
        "no-impact",
        kindOf(before.breaking, after.breaking),
        before.breaking,
        after.breaking,
        "breaking acknowledgement changed",
      ),
    );
  }
}

function diffTrigger(
  before: Trigger | undefined,
  after: Trigger | undefined,
  path: string,
  out: ManifestChange[],
): void {
  if (deepEqual(before, after)) return;
  if (before === undefined && after !== undefined) {
    out.push(change(path, "contract-breaking", "added", before, after, "trigger added"));
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push(change(path, "contract-breaking", "removed", before, after, "trigger removed"));
    return;
  }
  out.push(change(path, "contract-breaking", "changed", before, after, "trigger changed"));
}

function diffGatesList(
  before: string[] | undefined,
  after: string[] | undefined,
  path: string,
  out: ManifestChange[],
): void {
  const b = before ?? [];
  const a = after ?? [];
  if (setEqual(b, a) && listEqual(b, a)) return;
  if (setEqual(b, a)) {
    out.push(change(path, "no-impact", "changed", b, a, "gates reordered"));
    return;
  }

  const removed = setDiff(b, a);
  const added = setDiff(a, b);

  if (b.length > 0 && a.length === 0) {
    out.push(
      change(
        path,
        "permission-widening",
        "changed",
        b,
        a,
        "flow became public (all gates removed)",
      ),
    );
    return;
  }

  for (const gate of removed) {
    out.push(
      change(
        `${path}/${escape(gate)}`,
        "permission-widening",
        "removed",
        gate,
        undefined,
        `gate removed: ${gate}`,
      ),
    );
  }

  for (const gate of added) {
    out.push(
      change(
        `${path}/${escape(gate)}`,
        "no-impact",
        "added",
        undefined,
        gate,
        `gate added: ${gate}`,
      ),
    );
  }

  // Detect rate-limit expression changes when both sides have a rate:* gate with same strategy.
  const bRates = b.filter((g) => g.startsWith("rate:"));
  const aRates = a.filter((g) => g.startsWith("rate:"));
  for (const br of bRates) {
    const bParsed = parseRateGate(br);
    if (!bParsed) continue;
    for (const ar of aRates) {
      if (br === ar) continue;
      const aParsed = parseRateGate(ar);
      if (!aParsed) continue;
      if (bParsed.strategy !== aParsed.strategy) continue;
      if (removed.includes(br) && added.includes(ar) && aParsed.max > bParsed.max) {
        out.push(
          change(
            path,
            "permission-widening",
            "changed",
            br,
            ar,
            `rate limit widened: ${br} → ${ar}`,
          ),
        );
      }
    }
  }
}

function diffContractSchema(
  before: JsonSchema | undefined,
  after: JsonSchema | undefined,
  path: string,
  role: "in" | "out",
  out: ManifestChange[],
): void {
  if (deepEqual(before, after)) return;
  if (before === undefined && after !== undefined) {
    out.push(
      change(
        path,
        role === "in" ? "contract-breaking" : "no-impact",
        "added",
        before,
        after,
        `${role} schema added`,
      ),
    );
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push(
      change(
        path,
        role === "out" ? "contract-breaking" : "no-impact",
        "removed",
        before,
        after,
        `${role} schema removed`,
      ),
    );
    return;
  }
  if (typeof before === "string" || typeof after === "string") {
    out.push(
      change(path, "contract-breaking", "changed", before, after, `${role} schema ref changed`),
    );
    return;
  }
  if (
    schemaBreaksClients(before as Record<string, unknown>, after as Record<string, unknown>, role)
  ) {
    out.push(
      change(path, "contract-breaking", "changed", before, after, `${role} schema contract broke`),
    );
    return;
  }
  out.push(
    change(
      path,
      "no-impact",
      "changed",
      before,
      after,
      `${role} schema changed without client break`,
    ),
  );
}

function diffErrors(
  before: FlowErrors | undefined,
  after: FlowErrors | undefined,
  path: string,
  out: ManifestChange[],
): void {
  const bNames = errorNames(before);
  const aNames = errorNames(after);
  if (setEqual(bNames, aNames) && deepEqual(before, after)) return;

  for (const name of setDiff(bNames, aNames)) {
    out.push(
      change(
        `${path}/${escape(name)}`,
        "contract-breaking",
        "removed",
        name,
        undefined,
        `error removed: ${name}`,
      ),
    );
  }
  for (const name of setDiff(aNames, bNames)) {
    out.push(
      change(
        `${path}/${escape(name)}`,
        "no-impact",
        "added",
        undefined,
        name,
        `error added: ${name}`,
      ),
    );
  }

  if (before && after && !Array.isArray(before) && !Array.isArray(after)) {
    for (const name of intersection(bNames, aNames)) {
      if (!deepEqual(before[name], after[name])) {
        out.push(
          change(
            `${path}/${escape(name)}`,
            "contract-breaking",
            "changed",
            before[name],
            after[name],
            `error schema changed: ${name}`,
          ),
        );
      }
    }
  } else if (setEqual(bNames, aNames) && !deepEqual(before, after)) {
    out.push(change(path, "no-impact", "changed", before, after, "errors reordered"));
  }
}

function diffEffects(
  before: Effects | undefined,
  after: Effects | undefined,
  path: string,
  out: ManifestChange[],
): void {
  for (const key of EFFECT_KEYS) {
    const b = before?.[key] ?? [];
    const a = after?.[key] ?? [];
    if (setEqual(b, a)) {
      if (!listEqual(b, a) && b.length > 0) {
        out.push(change(`${path}/${key}`, "no-impact", "changed", b, a, `${key} reordered`));
      }
      continue;
    }
    for (const item of setDiff(a, b)) {
      out.push(
        change(
          `${path}/${key}/${escape(item)}`,
          "effect-widening",
          "added",
          undefined,
          item,
          `effect widened: ${key} += ${item}`,
        ),
      );
    }
    for (const item of setDiff(b, a)) {
      out.push(
        change(
          `${path}/${key}/${escape(item)}`,
          "no-impact",
          "removed",
          item,
          undefined,
          `effect narrowed: ${key} -= ${item}`,
        ),
      );
    }
  }
}

function diffSlo(
  before: Slo | undefined,
  after: Slo | undefined,
  path: string,
  out: ManifestChange[],
): void {
  if (deepEqual(before, after)) return;
  if (before === undefined && after !== undefined) {
    out.push(change(path, "no-impact", "added", before, after, "slo added"));
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push(change(path, "contract-breaking", "removed", before, after, "slo removed"));
    return;
  }
  const bAvail = parsePercent(before?.availability);
  const aAvail = parsePercent(after?.availability);
  if (bAvail !== undefined && aAvail !== undefined && aAvail < bAvail) {
    out.push(
      change(
        `${path}/availability`,
        "contract-breaking",
        "changed",
        before?.availability,
        after?.availability,
        `availability target lowered: ${before?.availability} → ${after?.availability}`,
      ),
    );
  } else if (before?.availability !== after?.availability) {
    out.push(
      change(
        `${path}/availability`,
        "no-impact",
        "changed",
        before?.availability,
        after?.availability,
        "availability target changed",
      ),
    );
  }

  if (!deepEqual(before?.latency, after?.latency)) {
    const loosened = latencyLoosened(before?.latency, after?.latency);
    out.push(
      change(
        `${path}/latency`,
        loosened ? "contract-breaking" : "no-impact",
        "changed",
        before?.latency,
        after?.latency,
        "latency objective changed",
      ),
    );
  }
}

function diffSignal(before: Signal, after: Signal, path: string, out: ManifestChange[]): void {
  if (before.delivery !== after.delivery) {
    out.push(
      change(
        `${path}/delivery`,
        "contract-breaking",
        "changed",
        before.delivery,
        after.delivery,
        `delivery changed: ${before.delivery} → ${after.delivery}`,
      ),
    );
  }
  if (before.retries !== after.retries) {
    const b = before.retries ?? 0;
    const a = after.retries ?? 0;
    out.push(
      change(
        `${path}/retries`,
        a < b ? "contract-breaking" : "no-impact",
        kindOf(before.retries, after.retries),
        before.retries,
        after.retries,
        `retries ${b} → ${a}`,
      ),
    );
  }
  if (before.deadLetter !== after.deadLetter) {
    out.push(
      change(
        `${path}/deadLetter`,
        before.deadLetter === true && after.deadLetter === false
          ? "contract-breaking"
          : "no-impact",
        kindOf(before.deadLetter, after.deadLetter),
        before.deadLetter,
        after.deadLetter,
        `deadLetter ${String(before.deadLetter)} → ${String(after.deadLetter)}`,
      ),
    );
  }
  if (!deepEqual(before.schema, after.schema)) {
    diffContractSchema(before.schema, after.schema, `${path}/schema`, "in", out);
  }
  if (before.optional !== after.optional) {
    out.push(
      change(
        `${path}/optional`,
        before.optional !== true && after.optional === true
          ? "no-impact"
          : after.optional === false
            ? "contract-breaking"
            : "no-impact",
        kindOf(before.optional, after.optional),
        before.optional,
        after.optional,
        "optional flag changed",
      ),
    );
  }
}

function diffStore(before: Store, after: Store, path: string, out: ManifestChange[]): void {
  if (before.facet !== after.facet) {
    out.push(
      change(
        `${path}/facet`,
        "contract-breaking",
        "changed",
        before.facet,
        after.facet,
        `store facet changed: ${before.facet} → ${after.facet}`,
      ),
    );
  }
  diffRecord(before.tables, after.tables, `${path}/tables`, diffTable, out);
  diffStringSet(before.namespaces, after.namespaces, `${path}/namespaces`, out);
  diffStringSet(before.buckets, after.buckets, `${path}/buckets`, out);
  diffStringSet(before.indexes, after.indexes, `${path}/indexes`, out);
  if (
    before.durable !== after.durable &&
    (before.durable !== undefined || after.durable !== undefined)
  ) {
    out.push(
      change(
        `${path}/durable`,
        after.durable === true ? "effect-widening" : "contract-breaking",
        "changed",
        before.durable,
        after.durable,
        `store durable ${String(before.durable)} → ${String(after.durable)}`,
      ),
    );
  }
  if (!deepEqual(before.classifications, after.classifications)) {
    out.push(
      change(
        `${path}/classifications`,
        classificationWeakened(before.classifications, after.classifications)
          ? "permission-widening"
          : "no-impact",
        "changed",
        before.classifications,
        after.classifications,
        "store classifications changed",
      ),
    );
  }
}

function diffTable(before: Table, after: Table, path: string, out: ManifestChange[]): void {
  if (!deepEqual(before.columns, after.columns)) {
    out.push(
      change(
        `${path}/columns`,
        classificationWeakened(before.columns, after.columns) ? "permission-widening" : "no-impact",
        "changed",
        before.columns,
        after.columns,
        "table columns/classifications changed",
      ),
    );
  }
  if (!deepEqual(before.classifications, after.classifications)) {
    out.push(
      change(
        `${path}/classifications`,
        classificationWeakened(before.classifications, after.classifications)
          ? "permission-widening"
          : "no-impact",
        "changed",
        before.classifications,
        after.classifications,
        "table classifications changed",
      ),
    );
  }
}

function diffClock(before: Clock, after: Clock, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  const scheduleChanged = before.cron !== after.cron || before.every !== after.every;
  out.push(
    change(
      path,
      scheduleChanged ? "contract-breaking" : "no-impact",
      "changed",
      before,
      after,
      scheduleChanged ? "clock schedule changed" : "clock metadata changed",
    ),
  );
}

function diffGateDef(before: Gate, after: Gate, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;

  const rolesRemoved = setDiff(before.roles, after.roles);
  const scopesRemoved = setDiff(before.scopes, after.scopes);
  const maxWidened = before.max !== undefined && after.max !== undefined && after.max > before.max;

  // Widened membership (e.g. roles: [staff] → [staff, member] or roles replaced by broader set)
  const rolesAdded = setDiff(after.roles, before.roles);
  const scopesAdded = setDiff(after.scopes, before.scopes);

  if (maxWidened || rolesAdded.length > 0 || scopesAdded.length > 0) {
    out.push(
      change(
        path,
        "permission-widening",
        "changed",
        before,
        after,
        maxWidened
          ? `rate max widened: ${before.max} → ${after.max}`
          : `gate widened: +${[...rolesAdded, ...scopesAdded].join(", ")}`,
      ),
    );
    return;
  }

  if (rolesRemoved.length > 0 || scopesRemoved.length > 0) {
    out.push(change(path, "no-impact", "changed", before, after, "gate narrowed"));
    return;
  }

  if (before.strategy !== after.strategy && before.strategy && after.strategy) {
    out.push(
      change(
        `${path}/strategy`,
        "contract-breaking",
        "changed",
        before.strategy,
        after.strategy,
        `rate strategy changed: ${before.strategy} → ${after.strategy}`,
      ),
    );
    return;
  }

  out.push(change(path, "no-impact", "changed", before, after, "gate definition changed"));
}

function diffSecret(
  before: SecretContract,
  after: SecretContract,
  path: string,
  out: ManifestChange[],
): void {
  if (deepEqual(before, after)) return;
  if (!deepEqual(before.schema, after.schema)) {
    out.push(
      change(
        `${path}/schema`,
        "contract-breaking",
        "changed",
        before.schema,
        after.schema,
        "secret contract schema changed",
      ),
    );
    return;
  }
  out.push(change(path, "no-impact", "changed", before, after, "secret contract metadata changed"));
}

function diffChannel(before: Channel, after: Channel, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  if (before.medium !== after.medium && before.medium && after.medium) {
    out.push(
      change(
        `${path}/medium`,
        "contract-breaking",
        "changed",
        before.medium,
        after.medium,
        `channel medium changed: ${before.medium} → ${after.medium}`,
      ),
    );
  }
  const localesRemoved = setDiff(before.locales, after.locales);
  const localesAdded = setDiff(after.locales, before.locales);
  for (const locale of localesRemoved) {
    out.push(
      change(
        `${path}/locales/${escape(locale)}`,
        "contract-breaking",
        "removed",
        locale,
        undefined,
        `locale removed: ${locale}`,
      ),
    );
  }
  for (const locale of localesAdded) {
    out.push(
      change(
        `${path}/locales/${escape(locale)}`,
        "no-impact",
        "added",
        undefined,
        locale,
        `locale added: ${locale}`,
      ),
    );
  }
  if (
    localesRemoved.length === 0 &&
    localesAdded.length === 0 &&
    before.medium === after.medium &&
    !deepEqual(before, after)
  ) {
    out.push(change(path, "no-impact", "changed", before, after, "channel metadata changed"));
  }
}

function diffPlugin(before: Plugin, after: Plugin, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  const interceptsAdded = setDiff(after.intercepts, before.intercepts);
  const declaresAdded = setDiff(after.declares, before.declares);
  if (interceptsAdded.length > 0 || declaresAdded.length > 0) {
    out.push(
      change(
        path,
        "permission-widening",
        "changed",
        before,
        after,
        `plugin capabilities widened: ${[...interceptsAdded, ...declaresAdded].join(", ")}`,
      ),
    );
    return;
  }
  out.push(change(path, "no-impact", "changed", before, after, "plugin metadata changed"));
}

function diffJourney(before: Journey, after: Journey, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  diffSlo(before.slo, after.slo, `${path}/slo`, out);
  if (before.composes !== after.composes) {
    const b = parsePercent(before.composes);
    const a = parsePercent(after.composes);
    out.push(
      change(
        `${path}/composes`,
        b !== undefined && a !== undefined && a < b ? "contract-breaking" : "no-impact",
        kindOf(before.composes, after.composes),
        before.composes,
        after.composes,
        "journey composition changed",
      ),
    );
  }
  if (!setEqual(before.flows, after.flows)) {
    out.push(
      change(
        `${path}/flows`,
        setDiff(before.flows, after.flows).length > 0 ? "contract-breaking" : "no-impact",
        "changed",
        before.flows,
        after.flows,
        "journey member flows changed",
      ),
    );
  }
}

function diffAi(before: Ai | undefined, after: Ai | undefined, out: ManifestChange[]): void {
  diffRecord(
    before?.models,
    after?.models,
    "/ai/models",
    (b, a, path, o) => {
      if (!deepEqual(b, a)) {
        o.push(change(path, "contract-breaking", "changed", b, a, "ai model changed"));
      }
    },
    out,
  );
  diffRecord(before?.prompts, after?.prompts, "/ai/prompts", diffPrompt, out);
  diffRecord(before?.agents, after?.agents, "/ai/agents", diffAgent, out);
}

function diffPrompt(before: AiPrompt, after: AiPrompt, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  if (before.version !== after.version) {
    out.push(
      change(
        `${path}/version`,
        "effect-widening",
        "changed",
        before.version,
        after.version,
        `prompt version ${before.version} → ${after.version}`,
      ),
    );
  }
  const bCost = before.budget?.maxCostPerCall ?? before.budget?.maxCostPerRun ?? 0;
  const aCost = after.budget?.maxCostPerCall ?? after.budget?.maxCostPerRun ?? 0;
  if (aCost > bCost) {
    out.push(
      change(
        `${path}/budget`,
        "effect-widening",
        "changed",
        before.budget,
        after.budget,
        "prompt budget increased",
      ),
    );
  } else if (!deepEqual(before.budget, after.budget) && before.version === after.version) {
    out.push(
      change(
        `${path}/budget`,
        "no-impact",
        "changed",
        before.budget,
        after.budget,
        "prompt budget changed",
      ),
    );
  }
  if (before.evals !== after.evals && before.version === after.version) {
    out.push(
      change(
        `${path}/evals`,
        "no-impact",
        kindOf(before.evals, after.evals),
        before.evals,
        after.evals,
        "prompt evals path changed",
      ),
    );
  }
  if (!deepEqual(before.in, after.in) || !deepEqual(before.out, after.out)) {
    if (!deepEqual(before.in, after.in)) {
      diffContractSchema(before.in, after.in, `${path}/in`, "in", out);
    }
    if (!deepEqual(before.out, after.out)) {
      diffContractSchema(before.out, after.out, `${path}/out`, "out", out);
    }
  }
}

function diffAgent(before: AiAgent, after: AiAgent, path: string, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  const toolsAdded = setDiff(after.tools, before.tools);
  const toolsRemoved = setDiff(before.tools, after.tools);
  for (const tool of toolsAdded) {
    out.push(
      change(
        `${path}/tools/${escape(tool)}`,
        "effect-widening",
        "added",
        undefined,
        tool,
        `agent tool added: ${tool}`,
      ),
    );
  }
  for (const tool of toolsRemoved) {
    out.push(
      change(
        `${path}/tools/${escape(tool)}`,
        "contract-breaking",
        "removed",
        tool,
        undefined,
        `agent tool removed: ${tool}`,
      ),
    );
  }
  if (before.maxSteps !== after.maxSteps) {
    const b = before.maxSteps ?? 0;
    const a = after.maxSteps ?? 0;
    out.push(
      change(
        `${path}/maxSteps`,
        a > b ? "effect-widening" : "no-impact",
        kindOf(before.maxSteps, after.maxSteps),
        before.maxSteps,
        after.maxSteps,
        `agent maxSteps ${b} → ${a}`,
      ),
    );
  }
  if (
    !deepEqual(before.budget, after.budget) &&
    toolsAdded.length === 0 &&
    toolsRemoved.length === 0
  ) {
    const bCost = before.budget?.maxCostPerRun ?? before.budget?.maxCostPerCall ?? 0;
    const aCost = after.budget?.maxCostPerRun ?? after.budget?.maxCostPerCall ?? 0;
    out.push(
      change(
        `${path}/budget`,
        aCost > bCost ? "effect-widening" : "no-impact",
        "changed",
        before.budget,
        after.budget,
        "agent budget changed",
      ),
    );
  }
}

function diffDrivers(
  before: Record<string, string[]> | undefined,
  after: Record<string, string[]> | undefined,
  out: ManifestChange[],
): void {
  const envs = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const env of sorted(envs)) {
    const path = `/drivers/${escape(env)}`;
    const b = before?.[env];
    const a = after?.[env];
    if (b === undefined && a !== undefined) {
      out.push(change(path, "no-impact", "added", b, a, `drivers for ${env} added`));
      continue;
    }
    if (b !== undefined && a === undefined) {
      out.push(change(path, "contract-breaking", "removed", b, a, `drivers for ${env} removed`));
      continue;
    }
    if (b && a && !setEqual(b, a)) {
      const removed = setDiff(b, a);
      const added = setDiff(a, b);
      if (removed.length > 0) {
        out.push(
          change(
            path,
            "contract-breaking",
            "changed",
            b,
            a,
            `drivers removed from ${env}: ${removed.join(", ")}`,
          ),
        );
      }
      if (added.length > 0) {
        out.push(
          change(
            path,
            "no-impact",
            "changed",
            b,
            a,
            `drivers added to ${env}: ${added.join(", ")}`,
          ),
        );
      }
    } else if (b && a && !listEqual(b, a)) {
      out.push(change(path, "no-impact", "changed", b, a, `drivers reordered for ${env}`));
    }
  }
}

function diffTenancy(
  before: Tenancy | undefined,
  after: Tenancy | undefined,
  out: ManifestChange[],
): void {
  if (deepEqual(before, after)) return;
  if (before === undefined && after !== undefined) {
    out.push(change("/tenancy", "no-impact", "added", before, after, "tenancy enabled"));
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push(
      change("/tenancy", "permission-widening", "removed", before, after, "tenancy disabled"),
    );
    return;
  }
  const b = before?.isolation ? ISOLATION_RANK[before.isolation] : undefined;
  const a = after?.isolation ? ISOLATION_RANK[after.isolation] : undefined;
  out.push(
    change(
      "/tenancy/isolation",
      b !== undefined && a !== undefined && a < b ? "permission-widening" : "no-impact",
      "changed",
      before?.isolation,
      after?.isolation,
      `tenancy isolation ${before?.isolation} → ${after?.isolation}`,
    ),
  );
}

function diffI18n(before: I18n | undefined, after: I18n | undefined, out: ManifestChange[]): void {
  if (deepEqual(before, after)) return;
  if (before === undefined && after !== undefined) {
    out.push(change("/i18n", "no-impact", "added", before, after, "i18n added"));
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push(change("/i18n", "contract-breaking", "removed", before, after, "i18n removed"));
    return;
  }
  for (const locale of setDiff(before?.locales, after?.locales)) {
    out.push(
      change(
        `/i18n/locales/${escape(locale)}`,
        "contract-breaking",
        "removed",
        locale,
        undefined,
        `locale removed: ${locale}`,
      ),
    );
  }
  for (const locale of setDiff(after?.locales, before?.locales)) {
    out.push(
      change(
        `/i18n/locales/${escape(locale)}`,
        "no-impact",
        "added",
        undefined,
        locale,
        `locale added: ${locale}`,
      ),
    );
  }
  if (before?.default !== after?.default) {
    out.push(
      change(
        "/i18n/default",
        "no-impact",
        "changed",
        before?.default,
        after?.default,
        "default locale changed",
      ),
    );
  }
  if (!deepEqual(before?.dir, after?.dir) && setEqual(before?.locales, after?.locales)) {
    out.push(
      change(
        "/i18n/dir",
        "no-impact",
        "changed",
        before?.dir,
        after?.dir,
        "locale dir map changed",
      ),
    );
  }
}

function diffTopology(
  before: Manifest["topology"],
  after: Manifest["topology"],
  out: ManifestChange[],
): void {
  if (before === after) return;
  const category: DiffCategory =
    before !== undefined && after !== undefined ? "contract-breaking" : "no-impact";
  out.push(
    change(
      "/topology",
      category,
      kindOf(before, after),
      before,
      after,
      `topology ${before ?? "∅"} → ${after ?? "∅"}`,
    ),
  );
}

function diffImages(
  before: Record<string, string> | undefined,
  after: Record<string, string> | undefined,
  out: ManifestChange[],
): void {
  if (deepEqual(before, after)) return;
  out.push(change("/images", "no-impact", "changed", before, after, "images changed"));
}

function diffStringSet(
  before: string[] | undefined,
  after: string[] | undefined,
  path: string,
  out: ManifestChange[],
): void {
  if (setEqual(before, after)) {
    if (before && after && !listEqual(before, after)) {
      out.push(change(path, "no-impact", "changed", before, after, `${path} reordered`));
    }
    return;
  }
  for (const item of setDiff(before, after)) {
    out.push(
      change(
        `${path}/${escape(item)}`,
        "contract-breaking",
        "removed",
        item,
        undefined,
        `removed ${item}`,
      ),
    );
  }
  for (const item of setDiff(after, before)) {
    out.push(
      change(`${path}/${escape(item)}`, "no-impact", "added", undefined, item, `added ${item}`),
    );
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function kindOf(before: unknown, after: unknown): ManifestChange["kind"] {
  if (before === undefined) return "added";
  if (after === undefined) return "removed";
  return "changed";
}

function errorNames(errors: FlowErrors | undefined): string[] {
  if (!errors) return [];
  if (Array.isArray(errors)) return errors;
  return Object.keys(errors);
}

function schemaBreaksClients(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  role: "in" | "out",
): boolean {
  if (before.type !== undefined && after.type !== undefined && before.type !== after.type) {
    return true;
  }

  const bProps = (before.properties ?? {}) as Record<string, unknown>;
  const aProps = (after.properties ?? {}) as Record<string, unknown>;
  const bReq = new Set(asStringArray(before.required));
  const aReq = new Set(asStringArray(after.required));

  if (role === "in") {
    for (const key of aReq) {
      if (!bReq.has(key)) return true;
    }
    for (const key of Object.keys(bProps)) {
      if (!(key in aProps)) continue;
      if (!deepEqual(bProps[key], aProps[key])) {
        const bt = (bProps[key] as { type?: unknown } | undefined)?.type;
        const at = (aProps[key] as { type?: unknown } | undefined)?.type;
        if (bt !== undefined && at !== undefined && bt !== at) return true;
        const bEnum = asUnknownArray((bProps[key] as { enum?: unknown })?.enum);
        const aEnum = asUnknownArray((aProps[key] as { enum?: unknown })?.enum);
        if (bEnum && aEnum && setDiff(bEnum.map(String), aEnum.map(String)).length > 0) {
          return true;
        }
      }
    }
    return false;
  }

  // out: removing a property or changing its type breaks clients
  for (const key of Object.keys(bProps)) {
    if (!(key in aProps)) return true;
    const bt = (bProps[key] as { type?: unknown } | undefined)?.type;
    const at = (aProps[key] as { type?: unknown } | undefined)?.type;
    if (bt !== undefined && at !== undefined && bt !== at) return true;
  }
  return false;
}

function classificationWeakened(before: unknown, after: unknown): boolean {
  if (!before || typeof before !== "object") return false;
  if (!after || typeof after !== "object") return true;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!(key in a)) return true;
    const bv = b[key];
    const av = a[key];
    if (isPii(bv) && !isPii(av)) return true;
    if (isSensitive(bv) && !isSensitive(av)) return true;
  }
  return false;
}

function isPii(value: unknown): boolean {
  if (value === "pii") return true;
  if (Array.isArray(value)) return value.includes("pii");
  if (value && typeof value === "object") {
    return (value as { pii?: boolean }).pii === true;
  }
  return false;
}

function isSensitive(value: unknown): boolean {
  if (value === "sensitive") return true;
  if (Array.isArray(value)) return value.includes("sensitive");
  if (value && typeof value === "object") {
    return (value as { sensitive?: boolean }).sensitive === true;
  }
  return false;
}

function parseRateGate(gate: string): { strategy: string; max: number; per: string } | undefined {
  // rate:sliding-window-counter:300/1m
  const m = /^rate:([^:]+):(\d+)\/(.+)$/.exec(gate);
  if (!m) return undefined;
  return { strategy: m[1]!, max: Number(m[2]), per: m[3]! };
}

function parsePercent(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (!m) return undefined;
  return Number(m[1]);
}

function latencyLoosened(
  before: Record<string, string> | undefined,
  after: Record<string, string> | undefined,
): boolean {
  if (!before || !after) return false;
  for (const key of Object.keys(before)) {
    if (!(key in after)) continue;
    const b = parseDurationMs(before[key]!);
    const a = parseDurationMs(after[key]!);
    if (b !== undefined && a !== undefined && a > b) return true;
  }
  return false;
}

function parseDurationMs(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] as "ms" | "s" | "m" | "h";
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60_000;
  return n * 3_600_000;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asUnknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function setEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const as = new Set(a ?? []);
  const bs = new Set(b ?? []);
  if (as.size !== bs.size) return false;
  for (const x of as) if (!bs.has(x)) return false;
  return true;
}

function listEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function setDiff(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  const bs = new Set(b ?? []);
  return [...new Set(a ?? [])].filter((x) => !bs.has(x)).sort();
}

function intersection(a: readonly string[], b: readonly string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

function sorted(keys: Iterable<string>): string[] {
  return [...keys].sort();
}

function escape(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** @internal helpers exposed for exhaustive unit coverage of pure branches. */
export const __test__ = {
  parseRateGate,
  parsePercent,
  parseDurationMs,
  schemaBreaksClients,
  classificationWeakened,
  latencyLoosened,
  highestSeverity,
};
