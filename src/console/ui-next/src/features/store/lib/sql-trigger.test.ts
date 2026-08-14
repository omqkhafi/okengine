import { describe, expect, test } from "bun:test";
import {
  buildCreateTriggerSql,
  DEFAULT_CREATE_TRIGGER_SQL,
  isCreateTriggerSql,
  isSafeTriggerWhen,
} from "./sql-trigger.ts";

describe("isCreateTriggerSql", () => {
  test("accepts the default template and OR REPLACE", () => {
    expect(isCreateTriggerSql(DEFAULT_CREATE_TRIGGER_SQL)).toBe(true);
    expect(
      isCreateTriggerSql(
        "create or replace trigger t after insert on bookings execute function f()",
      ),
    ).toBe(true);
  });

  test("rejects other statements", () => {
    expect(isCreateTriggerSql("SELECT 1")).toBe(false);
    expect(isCreateTriggerSql("CREATE FUNCTION f() RETURNS void AS $$ $$")).toBe(false);
    expect(isCreateTriggerSql("")).toBe(false);
  });
});

describe("buildCreateTriggerSql", () => {
  test("pretty-prints AFTER INSERT", () => {
    expect(
      buildCreateTriggerSql({
        name: "after_insert",
        table: "comments",
        timing: "AFTER",
        events: ["INSERT"],
        level: "ROW",
        functionName: "notify_comment",
      }),
    ).toBe(
      [
        'CREATE TRIGGER "after_insert"',
        "  AFTER INSERT",
        '  ON "comments"',
        "  FOR EACH ROW",
        '  EXECUTE FUNCTION "notify_comment"();',
      ].join("\n"),
    );
  });

  test("joins events, WHEN, schema function, and OR REPLACE", () => {
    expect(
      buildCreateTriggerSql({
        name: "after_write",
        table: "bookings",
        timing: "AFTER",
        events: ["INSERT", "UPDATE", "DELETE"],
        level: "ROW",
        functionName: "public.touch",
        when: "NEW.id IS NOT NULL",
        orReplace: true,
      }),
    ).toBe(
      [
        'CREATE OR REPLACE TRIGGER "after_write"',
        "  AFTER INSERT OR UPDATE OR DELETE",
        '  ON "bookings"',
        "  FOR EACH ROW",
        "  WHEN (NEW.id IS NOT NULL)",
        '  EXECUTE FUNCTION "public"."touch"();',
      ].join("\n"),
    );
  });

  test("adds CONSTRAINT, UPDATE OF, REFERENCING, and function args", () => {
    expect(
      buildCreateTriggerSql({
        name: "after_update",
        table: "bookings",
        timing: "AFTER",
        events: ["UPDATE"],
        level: "STATEMENT",
        functionName: "touch",
        constraint: true,
        defer: "deferred",
        updateOf: "status",
        referencingNew: "new_rows",
        functionArgs: "'ping'",
      }),
    ).toBe(
      [
        'CREATE CONSTRAINT TRIGGER "after_update"',
        "  AFTER UPDATE OF status",
        '  ON "bookings"',
        "  DEFERRABLE INITIALLY DEFERRED",
        '  REFERENCING NEW TABLE AS "new_rows"',
        "  FOR EACH STATEMENT",
        "  EXECUTE FUNCTION \"touch\"('ping');",
      ].join("\n"),
    );
  });

  test("omits unsafe WHEN", () => {
    const sql = buildCreateTriggerSql({
      name: "t",
      table: "bookings",
      timing: "BEFORE",
      events: ["DELETE"],
      level: "ROW",
      functionName: "f",
      when: "true; DROP TABLE bookings",
    });
    expect(sql).not.toContain("WHEN");
    expect(sql).not.toContain("DROP TABLE");
  });
});

describe("isSafeTriggerWhen", () => {
  test("allows a boolean expression", () => {
    expect(isSafeTriggerWhen("NEW.status = 'open'")).toBe(true);
  });

  test("rejects stacking and comments", () => {
    expect(isSafeTriggerWhen("true; SELECT 1")).toBe(false);
    expect(isSafeTriggerWhen("true -- x")).toBe(false);
    expect(isSafeTriggerWhen("true /* x */")).toBe(false);
  });
});
