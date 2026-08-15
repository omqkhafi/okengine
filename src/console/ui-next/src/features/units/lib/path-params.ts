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
  "attachments:id": "attachments/tsk_eng_12/spec.pdf",
  "tasks:id": "tsk_eng_12",
  "comments:id": "cmt_1",
  "projects:id": "proj_api",
  "spaces:id": "space_eng",
  "tags:id": "tag_bug",
  "tags:tagId": "tag_feature",
  "goals:id": "goal_harbor",
  "documents:id": "doc_prd_api",
  "members:id": "mem_aria",
  "forms:id": "form_customer",
  "drafts:id": "ENG-12",
  "views:id": "view_web_board",
  "inbox:id": "inb_1",
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
