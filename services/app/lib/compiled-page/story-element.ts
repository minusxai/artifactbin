/** The compiled reader's story root. Kept pure for the page assembler. */
import { STORY_ROOT_ATTR } from '@/lib/story-surface';
import { escapeHtml } from '@artifactbin/utils/escape';

export function inlineStoryElement(body: string, colorMode: string, theme: string | null): string {
  return `<div data-mx-inline-story="" ${STORY_ROOT_ATTR} class="${escapeHtml(colorMode)}"${theme ? ` data-theme="${escapeHtml(theme)}"` : ''}>${body}</div>`;
}
