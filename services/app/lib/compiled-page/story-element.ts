/** The compiled reader's story root, and the notice before it. Kept pure for the page assembler and the offline file. */
import { STORY_ROOT_ATTR, STORY_STYLED_ATTR } from '@/lib/story-surface';
import { SCRIPT_FAILURE_ATTR } from '@/lib/story-runtime/contract';
import { escapeHtml } from '@artifactbin/utils/escape';

/**
 * What every copy of a page whose script did not build says, before its story root (the assembler's `scriptFailed`,
 * the offline file's `scriptFailed`): what a reader needs, and nothing of the builder's.
 */
export const SCRIPT_FAILURE_NOTICE = `<div ${SCRIPT_FAILURE_ATTR}="" role="status" aria-label="Page script unavailable">`
  + 'This page\u2019s script could not load, so some of its controls may not respond. Its editors can see why on the document\u2019s page.</div>';
/**
 * The notice's own sheet: one quiet line in the document's kit tokens (`--muted`, `--muted-foreground`, `--border`, on
 * `:root` and `.dark`), with fallbacks for a page drawn without them. A page whose script builds carries none of it.
 */
export const SCRIPT_FAILURE_CSS = `[${SCRIPT_FAILURE_ATTR}]{box-sizing:border-box;max-width:100%;margin:0;padding:8px 16px;`
  + 'border-bottom:1px solid var(--border,rgba(127,127,127,.35));background:var(--muted,transparent);color:var(--muted-foreground,inherit);'
  + 'font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}';

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
