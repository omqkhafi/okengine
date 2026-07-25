import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export { ELEMENTS, POSITIONING } from './elements';

/**
 * Load Notes' `create` flow from the example source of truth.
 * Homepage displays this verbatim so it cannot drift from `examples/`.
 */
export function loadNotesCreateSnippet(): string {
  const path = join(
    process.cwd(),
    '..',
    'examples/notes/src/flows/notes/index.ts',
  );
  const full = readFileSync(path, 'utf8');
  const start = full.indexOf('export const create = ');
  if (start < 0) {
    throw new Error('notes-create: export const create not found');
  }
  const endMarker = '\n// effects → writes[sql:notes]';
  const end = full.indexOf(endMarker, start);
  if (end < 0) {
    throw new Error('notes-create: create block end not found');
  }
  return full.slice(start, end + endMarker.length).trimEnd();
}
