/**
 * OpenRouter decision-model catalog. Only fields the catalog actually returns.
 */

const CATALOG_URL = "https://openrouter.ai/api/v1/models?output_modalities=decisions";

interface CatalogRow {
  readonly id?: unknown;
  readonly canonical_slug?: unknown;
  readonly context_length?: unknown;
  readonly architecture?: { readonly input_modalities?: unknown };
  readonly alias_target?: { readonly slug?: unknown };
}

/**
 * Lines for `oke decide models`: id, canonical slug, context, input modalities.
 *
 * @param body - Catalog JSON
 */
export function formatDecisionModels(body: unknown): string {
  const rows = catalogRows(body);
  if (rows.length === 0) return "oke decide models: no decision models\n";
  const lines = ["id\tcanonical_slug\tcontext\tinput"];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    const canonical = typeof row.canonical_slug === "string" ? row.canonical_slug : "";
    const context = typeof row.context_length === "number" ? String(row.context_length) : "";
    const input = Array.isArray(row.architecture?.input_modalities)
      ? row.architecture.input_modalities.filter((item) => typeof item === "string").join(",")
      : "";
    lines.push(`${id}\t${canonical}\t${context}\t${input}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Fetch the public decision catalog and format it.
 *
 * @param fetcher - Injected fetch
 */
export async function fetchDecisionModels(
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const res = await fetcher(CATALOG_URL);
  if (!res.ok) throw new Error(`oke decide models: ${res.status}`);
  return formatDecisionModels(await res.json());
}

/**
 * Dated slug the catalog lists for `model`, when it differs from `model`.
 * Missing catalog, unknown id, or an undated canonical slug returns undefined.
 *
 * @param model - Decider model id
 * @param baseUrl - Decider URL. Only OpenRouter is queried.
 * @param pinning - `dated` looks up a slug. `alias` does not.
 * @param fetcher - Injected fetch
 */
export async function requiredDatedModel(
  model: string,
  baseUrl: string,
  pinning: "dated" | "alias",
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string | undefined> {
  if (pinning !== "dated" || !baseUrl.includes("openrouter.ai")) return undefined;
  try {
    const res = await fetcher(CATALOG_URL);
    if (!res.ok) return undefined;
    return datedSlug(catalogRows(await res.json()), model);
  } catch {
    return undefined;
  }
}

function catalogRows(body: unknown): CatalogRow[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? (data as CatalogRow[]) : [];
}

function datedSlug(rows: readonly CatalogRow[], model: string): string | undefined {
  const row = rows.find((item) => item.id === model);
  if (!row) return undefined;
  const target = typeof row.alias_target?.slug === "string" ? row.alias_target.slug : undefined;
  const followed = target ? rows.find((item) => item.id === target) : undefined;
  const canonical =
    typeof followed?.canonical_slug === "string"
      ? followed.canonical_slug
      : typeof row.canonical_slug === "string"
        ? row.canonical_slug
        : undefined;
  if (!canonical || !/-\d{8}$/.test(canonical) || canonical === model) return undefined;
  return canonical;
}
