/**
 * Human-facing label for a technical key when an optional description exists.
 *
 * @param key - Technical identifier (Manifest map key / declaration name)
 * @param description - Optional human description
 */
export function displayLabel(key: string, description?: string | null): string {
  return description && description.length > 0 ? description : key;
}
