/**
 * `oke.row_passes_policies` — synthetic-row RLS replay for CDC live queries.
 *
 * When a table row changes (CDC event), live-query fan-out must decide per
 * subscriber whether the OLD version of the row was visible (`beforeVisible`)
 * without heap access — after an UPDATE the heap holds only the after-image,
 * after a DELETE nothing remains. The subscriber's stamped connection
 * (`SET LOCAL ROLE oke_app` + `oke.*` GUCs) evaluates policies natively for
 * heap rows; this helper gives the SAME verdict for a JSONB payload by
 * replaying expressions straight from `pg_policies`.
 *
 * Parity contract (src/elements/store/rls-row-passes-policies.parity.test.ts):
 *   replay(table, rowJson, "SELECT") === native stamped `WHERE pk = …` verdict
 * across every shipped policy family (owner / tenant / gate / scope) and their
 * real compositions, plus WITH CHECK probes via native INSERT attempts.
 *
 * Expression rewriting (inside the SQL function, per policy, per call):
 * 1. Bare column tokens (resolved from `pg_attribute` of the SAME table) are
 *    first wrapped in a placeholder `<<col>>`, then placeholders are
 *    substituted with `(row_data->>'col')` once per column. Two-phase keeps
 *    a single regexp_replace pass idempotent — a direct wrap re-matches on
 *    every pass ((row_data->>'col')'s tail still sits between valid word
 *    boundaries) and the loop never stabilizes.
 * 2. The replacement string is DOLLAR-QUOTED (`$re$\1<<\2>>\3$re$`), never
 *    E''-quoted: plpgsql folds `E'\1'` at body-compile time into chr(1),
 *    silently corrupting backreferences.
 * 3. `<`/`>` are excluded from both boundary classes so `<<col>>` cannot
 *    re-match; single-quoted literals are protected because `'` is excluded
 *    from boundaries too — `'owner'` never trips a column named `owner`.
 * 4. `oke.*` helpers survive: their segments follow a `.` (excluded left
 *    boundary). pg_policies stores them qualification-stripped
 *    (`"user"()`); `"user"` is not a column token so it passes through and
 *    resolves via search_path to oke.user() exactly as it does natively.
 * 5. Keyword-shaped tokens are skipped; placeholder substitution uses plain
 *    replace() so `id` never corrupts an already-substituted accessor.
 *
 * Semantics mirror native RLS:
 * - `ALL` policies apply to every command; others match their own.
 * - Visibility replays SELECT semantics: `qual` governs; INSERT-only
 *   policies (with_check, no qual) never gate visibility.
 * - PERMISSIVE OR together, RESTRICTIVE AND; zero applicable policies on an
 *   RLS-enabled table denies everything.
 */

/** One statement per exec — drivers reject multi-command batches on `query`. */
export const ROW_PASSES_POLICIES_STATEMENTS: readonly string[] = [
  String.raw`CREATE OR REPLACE FUNCTION oke.row_passes_policies(
  p_table text,
  p_row jsonb,
  p_command text
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_oid oid;
  v_rls boolean := false;
  pol record;
  col record;
  expr text;
  next_text text;
  n int;
  acc text;
  verdict boolean;
  permissive_pass boolean := false;
  has_permissive boolean := false;
  restrictive_pass boolean := true;
  has_restrictive boolean := false;
BEGIN
  SELECT c.oid, c.relrowsecurity INTO v_oid, v_rls
    FROM pg_class c
    JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
   WHERE c.relname = split_part(p_table, '.', 2)
      OR c.relname = p_table
   ORDER BY (nsp.nspname = 'public') DESC
   LIMIT 1;

  IF v_oid IS NULL OR NOT COALESCE(v_rls, false) THEN
    RETURN true; -- unknown table or RLS off: everything visible (native parity)
  END IF;

  FOR pol IN
    SELECT policyname, permissive, cmd, qual, with_check
      FROM pg_policies
     WHERE tablename = split_part(p_table, '.', 2)
        OR tablename = p_table
  LOOP
    IF pol.cmd <> 'ALL' AND upper(p_command) <> pol.cmd THEN
      CONTINUE;
    END IF;

    -- Visibility replays SELECT semantics: USING (qual) governs; an
    -- INSERT-only policy (with_check, no qual) never gates visibility.
    expr := CASE
      WHEN pol.cmd = 'INSERT' THEN NULL
      ELSE COALESCE(pol.qual, pol.with_check)
    END;

    CONTINUE WHEN expr IS NULL;

    FOR col IN
      SELECT a.attname AS name
        FROM pg_attribute a
       WHERE a.attrelid = v_oid
         AND a.attnum > 0
         AND NOT a.attisdropped
       ORDER BY a.attnum
    LOOP
      IF lower(col.name) IN (
        'and','or','not','is','in','like','ilike','between','exists',
        'case','when','then','else','end','true','false','null'
      ) THEN
        CONTINUE;
      END IF;

      -- Phase 1: wrap bare tokens as <<col>>. '<'/'>' sit outside the word
      -- boundary classes, so the substituted form can never re-match and the
      -- stabilization pass count is bounded by pathological overlaps only.
      n := 0;
      LOOP
        n := n + 1;
        IF n > 100 THEN
          RAISE EXCEPTION 'row_passes_policies rewrite did not stabilize (%)', pol.policyname;
        END IF;
        next_text := replace(
          regexp_replace(
            expr,
            '(^|[^A-Za-z0-9_''.<>])(' || col.name || ')($|[^A-Za-z0-9''<>])',
            $re$\1<<\2>>\3$re$,
            'g'
          ),
          chr(1) || '<<' || col.name || '>>' || chr(1),
          '<<' || col.name || '>>'
        );
        EXIT WHEN next_text = expr;
        expr := next_text;
      END LOOP;

      -- Phase 2: placeholders -> jsonb accessor (plain replace, order-safe).
      acc := '(row_data->>''' || col.name || ''')';
      expr := replace(expr, '<<' || col.name || '>>', acc);
    END LOOP;

    BEGIN
      EXECUTE format('SELECT (%s) FROM (SELECT %L::jsonb AS row_data) AS t',
                     expr, p_row::text) INTO verdict;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'row_passes_policies replay failed (%): %',
        pol.policyname, SQLERRM;
    END;

    IF pol.permissive = 'PERMISSIVE' THEN
      has_permissive := true;
      IF verdict THEN permissive_pass := true; END IF;
    ELSE
      has_restrictive := true;
      IF NOT verdict THEN restrictive_pass := false; END IF;
    END IF;
  END LOOP;

  IF NOT has_permissive AND NOT has_restrictive THEN
    RETURN false; -- RLS enabled, zero applicable policies: Postgres denies all
  END IF;
  RETURN (NOT has_restrictive OR restrictive_pass)
     AND (NOT has_permissive OR permissive_pass);
END
$fn$`,
];

/**
 * Probe for one replay evaluation.
 *
 * Prefer `sql`/`params` with drivers that bind JSON as an explicit type;
 * Bun.SQL binds JS strings as unknown, so `$2::jsonb` yields a jsonb
 * string scalar and `->>` lookups return NULL (live-PG parity failure).
 * {@link buildInlineRowPassesSql} inlines the image safely instead.
 *
 * @param table - Table (bare name or `schema.table`)
 * @param row - Synthetic row image (JSON-serializable)
 * @param command - Command context (`SELECT` = visibility)
 */
export interface RowPassesProbe {
  readonly sql: string;
  readonly params: [string, string, string];
}

/** Escape a value for inline SQL literal embedding. */
function escapeSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Inline-literal probe SQL — portable across pg drivers regardless of how
 * each binds JS strings. Row payload and table name are escaped; command
 * comes from a closed union.
 *
 * @param table - Table (bare name or `schema.table`)
 * @param row - Synthetic row image
 * @param command - Command context
 */
export function buildInlineRowPassesSql(
  table: string,
  row: Readonly<Record<string, unknown>>,
  command: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE" = "SELECT",
): string {
  const tableArg = escapeSqlLiteral(table);
  const rowArg = `${escapeSqlLiteral(JSON.stringify(row))}::jsonb`;
  return `SELECT oke.row_passes_policies(${tableArg}, ${rowArg}, ${escapeSqlLiteral(command)}) AS ok`;
}

/** Build a single replay probe (runs under the caller's RLS stamp). */
export function buildRowPassesProbe(
  table: string,
  row: Readonly<Record<string, unknown>>,
  command: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE" = "SELECT",
): RowPassesProbe {
  return {
    sql: "SELECT oke.row_passes_policies(?, ?, ?) AS ok",
    params: [table, JSON.stringify(row), command],
  };
}
