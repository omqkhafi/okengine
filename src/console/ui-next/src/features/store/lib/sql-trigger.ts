/**
 * CREATE TRIGGER starter, templates, and preview SQL for the Triggers sheet.
 */

import { quotePgIdent } from "../../../../../../drivers/pg-rls.ts";

/** When the trigger fires. */
export type SqlTriggerTiming = "BEFORE" | "AFTER" | "INSTEAD OF";

/** Event the trigger listens for. */
export type SqlTriggerEvent = "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";

/** Row vs statement trigger. */
export type SqlTriggerLevel = "ROW" | "STATEMENT";

/** Constraint trigger deferral (only with `CONSTRAINT`). */
export type SqlTriggerDefer = "immediate" | "deferred";

/** Fields for `CREATE TRIGGER`. */
export type SqlTriggerSpec = {
  readonly name: string;
  readonly table: string;
  readonly timing: SqlTriggerTiming;
  readonly events: readonly SqlTriggerEvent[];
  readonly level: SqlTriggerLevel;
  readonly functionName: string;
  readonly when?: string;
  readonly orReplace?: boolean;
  readonly constraint?: boolean;
  readonly defer?: SqlTriggerDefer;
  readonly updateOf?: string;
  readonly referencingOld?: string;
  readonly referencingNew?: string;
  readonly functionArgs?: string;
};

/** One starter template for the New trigger sheet. */
export type SqlTriggerTemplate = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly timing: SqlTriggerTiming;
  readonly events: readonly SqlTriggerEvent[];
  readonly level: SqlTriggerLevel;
};

/** Common Postgres trigger starters. */
export const SQL_TRIGGER_TEMPLATES: readonly SqlTriggerTemplate[] = [
  {
    id: "after-insert",
    title: "After insert",
    detail: "AFTER INSERT for each row — run a function when a row is added.",
    timing: "AFTER",
    events: ["INSERT"],
    level: "ROW",
  },
  {
    id: "after-update",
    title: "After update",
    detail: "AFTER UPDATE for each row — react when a row changes.",
    timing: "AFTER",
    events: ["UPDATE"],
    level: "ROW",
  },
  {
    id: "before-delete",
    title: "Before delete",
    detail: "BEFORE DELETE for each row — inspect or block a delete.",
    timing: "BEFORE",
    events: ["DELETE"],
    level: "ROW",
  },
  {
    id: "after-write",
    title: "After write",
    detail: "AFTER INSERT OR UPDATE OR DELETE — one function for any write.",
    timing: "AFTER",
    events: ["INSERT", "UPDATE", "DELETE"],
    level: "ROW",
  },
];

/**
 * Pretty `CREATE TRIGGER` for the review editor.
 *
 * @param spec - Trigger fields
 */
export function buildCreateTriggerSql(spec: SqlTriggerSpec): string {
  const events = formatTriggerEvents(spec.events, spec.updateOf);
  const replace = spec.orReplace === true ? "OR REPLACE " : "";
  const constraint = spec.constraint === true ? "CONSTRAINT " : "";
  const lines = [
    `CREATE ${replace}${constraint}TRIGGER ${quotePgIdent(spec.name)}`,
    `  ${spec.timing} ${events}`,
    `  ON ${quotePgIdent(spec.table)}`,
  ];
  if (spec.constraint === true && spec.defer === "deferred") {
    lines.push("  DEFERRABLE INITIALLY DEFERRED");
  } else if (spec.constraint === true && spec.defer === "immediate") {
    lines.push("  DEFERRABLE INITIALLY IMMEDIATE");
  }
  const referencing = formatTriggerReferencing(spec.referencingOld, spec.referencingNew);
  if (referencing !== "") lines.push(`  ${referencing}`);
  lines.push(`  FOR EACH ${spec.level}`);
  const when = spec.when?.trim() ?? "";
  if (when !== "" && isSafeTriggerWhen(when)) {
    lines.push(`  WHEN (${when})`);
  }
  const args =
    spec.functionArgs !== undefined && isSafeTriggerWhen(spec.functionArgs.trim())
      ? spec.functionArgs.trim()
      : "";
  lines.push(`  EXECUTE FUNCTION ${quoteFunctionName(spec.functionName)}(${args});`);
  return lines.join("\n");
}

/** Default body shown in the New trigger sheet. */
export const DEFAULT_CREATE_TRIGGER_SQL = buildCreateTriggerSql({
  name: "trigger_name",
  table: "table_name",
  timing: "AFTER",
  events: ["INSERT", "UPDATE", "DELETE"],
  level: "ROW",
  functionName: "function_name",
});

/**
 * True when the buffer is a CREATE TRIGGER statement (or OR REPLACE / CONSTRAINT).
 *
 * @param sql - Editor buffer
 */
export function isCreateTriggerSql(sql: string): boolean {
  return /^\s*CREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER\b/i.test(sql);
}

/**
 * True when `expr` is a single WHEN expression (no statement stacking).
 *
 * @param expr - WHEN body
 */
export function isSafeTriggerWhen(expr: string): boolean {
  const t = expr.trim();
  return t.length > 0 && t.length <= 2000 && !/;/.test(t) && !/--/.test(t) && !/\/\*/.test(t);
}

/**
 * Count of Advanced trigger knobs that are set.
 *
 * @param spec - Trigger fields
 */
export function sqlTriggerAdvancedCount(
  spec: Pick<
    SqlTriggerSpec,
    | "constraint"
    | "defer"
    | "updateOf"
    | "referencingOld"
    | "referencingNew"
    | "functionArgs"
    | "events"
  >,
): number {
  return (
    (spec.constraint === true ? 1 : 0) +
    (spec.defer !== undefined ? 1 : 0) +
    (spec.updateOf?.trim() ? 1 : 0) +
    (spec.referencingOld?.trim() ? 1 : 0) +
    (spec.referencingNew?.trim() ? 1 : 0) +
    (spec.functionArgs?.trim() ? 1 : 0) +
    (spec.events.includes("TRUNCATE") ? 1 : 0)
  );
}

function formatTriggerEvents(
  events: readonly SqlTriggerEvent[],
  updateOf: string | undefined,
): string {
  const list = events.length > 0 ? events : (["INSERT"] as const);
  const of = updateOf?.trim() ?? "";
  return list
    .map((event) => {
      if (event === "UPDATE" && of !== "" && isSafeTriggerWhen(of)) {
        return `UPDATE OF ${of}`;
      }
      return event;
    })
    .join(" OR ");
}

function formatTriggerReferencing(
  oldTable: string | undefined,
  newTable: string | undefined,
): string {
  const parts: string[] = [];
  const oldName = oldTable?.trim() ?? "";
  const newName = newTable?.trim() ?? "";
  if (oldName !== "" && isSafeTriggerWhen(oldName)) {
    parts.push(`OLD TABLE AS ${quotePgIdent(oldName)}`);
  }
  if (newName !== "" && isSafeTriggerWhen(newName)) {
    parts.push(`NEW TABLE AS ${quotePgIdent(newName)}`);
  }
  return parts.length > 0 ? `REFERENCING ${parts.join(" ")}` : "";
}

function quoteFunctionName(raw: string): string {
  const name = raw.trim().replace(/\(\s*\)$/, "");
  const parts = (name.length > 0 ? name : "function_name").split(".");
  return parts.map((part) => quotePgIdent(part)).join(".");
}
