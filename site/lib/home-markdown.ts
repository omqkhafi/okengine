/**
 * Homepage markdown twin — identity fields already published in site metadata,
 * plus the same three machine/nav entry points the 404 body uses.
 */

import { markdownResponse } from "./markdown-response";
import { SITE_DESCRIPTION, SITE_NAME } from "./site-identity";

/**
 * Markdown body for `/` when Accept prefers markdown.
 */
export function homepageMarkdownBody(): string {
  return `# ${SITE_NAME}

${SITE_DESCRIPTION}

- [Documentation](/docs)
- [llms.txt](/llms.txt)
- [Changelog](/changelog)
`;
}

/**
 * 200 markdown Response for the homepage twin.
 */
export function homepageMarkdownResponse(): Response {
  return markdownResponse(homepageMarkdownBody());
}
