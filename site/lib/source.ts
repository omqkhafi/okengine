import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/plugins/lucide-icons';
import { readDocsSourceBody } from './markdown-source';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { sidebarIconsPlugin } from './sidebar-icons';

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin(), sidebarIconsPlugin()],
});

/**
 * Build the OG image URL for a docs page.
 *
 * @param page - Loaded docs page
 */
export function getPageImageUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: '/' + [page.locale, ...docsImageRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

/**
 * Build the per-page markdown URL used by Copy Markdown / Open-in prompts.
 *
 * @param page - Loaded docs page
 */
export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: '/' + [page.locale, ...docsContentRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

/**
 * Source-identical markdown for Copy / `.md` routes (frontmatter stripped).
 *
 * @param page - Loaded docs page
 */
export async function getPageSourceMarkdown(
  page: (typeof source)['$inferPage'],
): Promise<string> {
  return readDocsSourceBody(page.path);
}

/**
 * Concatenated LLM dump for a page (`llms-full.txt` only).
 *
 * @param page - Loaded docs page
 */
export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
