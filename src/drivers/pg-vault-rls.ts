/**
 * Tenant RLS on `oke_vault_secrets` — kept off the Store-only `oke()` graph.
 *
 * Same `oke.tenant()` helper as domain tables. Loaded from helper install
 * and Vault DDL via a computed require.
 */

/** Same role as `OKE_RLS_ROLE` (`oke_app`) — duplicated so this module stays off `pg-rls`. */
const VAULT_RLS_ROLE = "oke_app";

/**
 * Built-in Vault ciphertext table. Global rows (`tenant_id IS NULL`) stay
 * visible; per-tenant rows are isolated. No-op until `oke_vault_secrets`
 * and `oke.tenant()` exist.
 *
 * ENABLE without FORCE: the Vault adapter (table owner) still sees every
 * row; Console / `oke_app` stamped SQL cannot list another tenant's
 * ciphertext.
 */
export const OKE_VAULT_SECRETS_TENANT_RLS_SQL = `DO $oke_vault_rls$
BEGIN
  IF to_regclass('public.oke_vault_secrets') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'oke' AND p.proname = 'tenant' AND p.pronargs = 0
  ) THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE oke_vault_secrets ENABLE ROW LEVEL SECURITY';
  BEGIN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON oke_vault_secrets TO ${VAULT_RLS_ROLE}';
  EXCEPTION
    WHEN undefined_object THEN NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'oke_vault_secrets'
      AND policyname = 'oke_vault_secrets_tenant'
  ) THEN
    EXECUTE $p$
      CREATE POLICY oke_vault_secrets_tenant ON oke_vault_secrets
        AS PERMISSIVE FOR ALL TO public
        USING (tenant_id = oke.tenant() OR tenant_id IS NULL)
        WITH CHECK (tenant_id = oke.tenant() OR tenant_id IS NULL)
    $p$;
  END IF;
END
$oke_vault_rls$`;

/**
 * Attach tenant RLS to `oke_vault_secrets` when the table and `oke.tenant()`
 * are both present. Safe to call from Vault DDL and from helper install
 * (either boot order).
 *
 * @param exec - Statement runner
 */
export async function ensureVaultSecretsTenantRls(
  exec: (sql: string) => Promise<unknown>,
): Promise<void> {
  await exec(OKE_VAULT_SECRETS_TENANT_RLS_SQL);
}

/** Short name for the Store-only `oke()` helper-install path. */
export { ensureVaultSecretsTenantRls as attach };
