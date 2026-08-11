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
