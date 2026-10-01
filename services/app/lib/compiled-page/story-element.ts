/** The compiled reader's story root. Kept pure for the page assembler. */
import { STORY_ROOT_ATTR, STORY_STYLED_ATTR } from '@/lib/story-surface';
import { escapeHtml } from '@artifactbin/utils/escape';

/**
 * A start tag that carries a `class` attribute, or a style/script element (skipped whole: its text is not markup).
 * Attribute values and text are escaped (`>` included), so `[^>]*` never leaves the tag it started in.
 */
const CLASS_OR_RAW_TEXT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<[a-zA-Z][^>]*?\sclass\s*=/gi;

/** Whether any element in `html` carries a class: the author styled the document. Stops at the first one. */
export function htmlCarriesClass(html: string): boolean {
  for (const match of html.matchAll(CLASS_OR_RAW_TEXT)) if (!match[1]) return true;
  return false;
}

export function inlineStoryElement(body: string, colorMode: string, theme: string | null): string {
  return `<div data-mx-inline-story="" ${STORY_ROOT_ATTR} class="${escapeHtml(colorMode)}"${theme ? ` data-theme="${escapeHtml(theme)}"` : ''}${htmlCarriesClass(body) ? ` ${STORY_STYLED_ATTR}=""` : ''}>${body}</div>`;
}
