/**
 * The scroll AFFORDANCE on a table wider than its column.
 *
 * Every served document makes each table its own scroll box (chrome-css
 * STORY_TABLE_CSS), so a wide table scrolls inside the column instead of
 * pushing the page sideways. What CSS cannot decide alone is whether a given
 * table actually overflows — that is a layout fact — and a scroll box with no
 * sign that it scrolls reads as a table cut off mid-word (measured, on a
 * phone, before this). So this marks each overflowing table
 * `data-mx-scrollable`, and the sheet fades its trailing edge; the mark says
 * `end` once the reader has scrolled to the last column, which drops the
 * fade — nothing is hidden there any more.
 *
 * Runs from the ~1 KB entry every document loads (anchor-entry), because a
 * prose document has tables too and ships no runtime. React-free.
 */
export const SCROLLABLE_ATTR = 'data-mx-scrollable';

/** Mark now, and keep the marks honest on scroll and resize. Returns a disposer. */
export function markScrollableTables(doc: Document): () => void {
  const win = doc.defaultView;
  const tables = () => [...doc.querySelectorAll<HTMLTableElement>('table')];

  const measure = (table: HTMLTableElement) => {
    const overflows = table.scrollWidth > table.clientWidth + 1;
    if (!overflows) { table.removeAttribute(SCROLLABLE_ATTR); return; }
    const atEnd = table.scrollLeft + table.clientWidth >= table.scrollWidth - 1;
    table.setAttribute(SCROLLABLE_ATTR, atEnd ? 'end' : '');
  };
  const measureAll = () => { for (const t of tables()) measure(t); };

  const onScroll = (e: Event) => { const t = e.currentTarget as HTMLTableElement | null; if (t) measure(t); };
  const wired = new Set<HTMLTableElement>();
  const wire = () => {
    for (const t of tables()) {
      if (wired.has(t)) continue;
      wired.add(t);
      t.addEventListener('scroll', onScroll, { passive: true });
    }
  };

  const sweep = () => { wire(); measureAll(); };

  sweep();
  // Fonts and embeds land after first paint and change every width; a pass
  // once they have settled catches what the first could not see.
  const settle = win?.setTimeout(sweep, 800);
  win?.addEventListener('resize', measureAll);

  /*
   * A table can ARRIVE LATER, and more than one way: an agent's write
   * re-renders the document in place (mx:document), a query re-run replaces a
   * `<DataTable>`'s rows, a lazy embed mounts. A one-shot wiring left every
   * one of those unmarked — a wide table with no fade and no end state, which
   * is the exact failure the fade exists to prevent. So the sweep runs again
   * whenever the document's subtree changes, coalesced into a frame so a
   * burst of edits costs one pass.
   */
  let queued = 0;
  const observer = win ? new win.MutationObserver(() => {
    if (queued) return;
    queued = win.setTimeout(() => { queued = 0; sweep(); }, 16);
  }) : null;
  observer?.observe(doc.body, { childList: true, subtree: true });

  return () => {
    if (win) {
      win.removeEventListener('resize', measureAll);
      if (settle) win.clearTimeout(settle);
      if (queued) win.clearTimeout(queued);
    }
    observer?.disconnect();
    for (const t of wired) t.removeEventListener('scroll', onScroll);
    wired.clear();
  };
}
