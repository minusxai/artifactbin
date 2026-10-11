/** The same outline markup for the server's first paint and live doc edits. */
import { escapeHtml } from '@artifactbin/utils/escape';
import type { JsxNode } from '@/lib/jsx';
import { discoverOutline, type OutlineEntry } from './outline';

function rowsHtml(entries: readonly OutlineEntry[]): string {
  let section = 0;
  return '<div class="mx-outline-label">Contents</div>' + entries.map(entry => {
    if (entry.level === 2) section++;
    const label = entry.level === 2 ? `Go to section ${section}: ${entry.title}` : `Go to ${entry.title}`;
    const cls = entry.level === 3 ? 'mx-outline-row mx-outline-sub' : 'mx-outline-row';
    return `<button type="button" class="${cls}" aria-label="${escapeHtml(label)}" data-mx-target="${escapeHtml(entry.path)}">${escapeHtml(entry.title)}</button>`;
  }).join('');
}

export function renderOutlineRail(entries: readonly OutlineEntry[]): string {
  return `<nav class="mx-outline" aria-label="Contents"${entries.length ? '' : ' hidden'}>${rowsHtml(entries)}</nav>`;
}

const drawn = new WeakMap<HTMLElement, string>();
/** Update only navigation: the column and its focused editor never move or remount. */
export function syncDocumentOutline(root: HTMLElement, nodes: JsxNode[]): void {
  const column = root.querySelector('.mx-doc--document');
  const rail = column?.parentElement?.querySelector<HTMLElement>(':scope > .mx-outline');
  if (!rail) return;
  const entries = discoverOutline(nodes, true);
  const signature = JSON.stringify(entries);
  if (drawn.get(rail) === signature) return;
  rail.innerHTML = rowsHtml(entries);
  rail.hidden = entries.length === 0;
  drawn.set(rail, signature);
}
