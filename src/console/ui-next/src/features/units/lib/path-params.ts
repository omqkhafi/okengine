/**
 * Extract `:param` names from an HTTP path pattern.
 *
 * @param path - Route path (e.g. `/notes/:id`)
 */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.startsWith(":") && segment.length > 1) {
      names.push(segment.slice(1));
    }
  }
  return names;
}

/**
 * Empty-field holder for a path param — the route token (`:id`).
 *
 * @param name - Param name without the colon
 */
export function pathParamPlaceholder(name: string): string {
  return `:${name}`;
}

/** Keel seed ids so Call API path fields are callable without guessing. */
const SEED_PATH_EXAMPLES: Readonly<Record<string, string>> = {
  "attachments:id": "attachments/ENG-184/spec.pdf",
  "issues:id": "iss_eng_184",
  "comments:id": "cmt_1",
  "projects:id": "proj_traces",
  "teams:id": "team_eng",
  "labels:id": "lab_bug",
  "labels:labelId": "lab_feature",
  "cycles:id": "cyc_25",
  "documents:id": "doc_prd_traces",
  "members:id": "mem_aria",
  "triage:id": "iss_sup_12",
  "drafts:id": "ENG-184",
  "milestones:mid": "ms_alpha",
  "initiatives:id": "init_console",
};

/**
 * Seeded example value for a Call API path param, when the route is known.
 *
 * @param path - HTTP path pattern (`/attachments/:id`)
 * @param name - Param name without the colon
 */
export function pathParamExample(path: string, name: string): string | undefined {
  const parts = path.split("/").filter(Boolean);
  const token = `:${name}`;
  const idx = parts.indexOf(token);
  const prev = idx > 0 ? parts[idx - 1] : undefined;
  const keyed = prev ? SEED_PATH_EXAMPLES[`${prev}:${name}`] : undefined;
  return keyed ?? SEED_PATH_EXAMPLES[`:${name}`];
}

/**
 * Prefill path params with seed examples (empty object when none apply).
 *
 * @param path - HTTP path pattern
 * @param names - Param names
 */
export function seedPathValues(
  path: string | null | undefined,
  names: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!path) return out;
  for (const name of names) {
    const example = pathParamExample(path, name);
    if (example) out[name] = example;
  }
  return out;
}
