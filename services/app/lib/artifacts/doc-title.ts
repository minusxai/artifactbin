/**
 * A DOC IS NAMED BY ITS FIRST HEADING (a page made by "New", `meta.template === 'doc'`): when its live regions are saved
 * (./store saveRegionsLocked), its name — the row's title and the page's `<title>` — follows the heading as long as it
 * still names the heading it was saved with, or that heading was empty. A rename to anything else (the rename dialog's
 * metadata write, or an author's own `<title>`) stops the following; an emptied heading leaves the name as it was.
 */
import { firstHeadingText, withPageTitle } from '../html-page';

export function docTitleAfterSave(current: { meta: Record<string, unknown>; title: string | null; source: string | null }, html: string): { html: string; title: string } | null {
  if (current.meta.template !== 'doc') return null;
  const before = firstHeadingText(current.source ?? ''), after = firstHeadingText(html);
  if (!after || after === before || (before && (current.title ?? '').trim() !== before)) return null;
  return { html: withPageTitle(html, after), title: after };
}
