/**
 * The OUTLINE's behaviour — wired from the ~1 KB entry EVERY document loads
 * (anchor-entry), never from the runtime.
 *
 * The rail's markup is server-rendered by the runtime's React tree so it is
 * in the SSR string at its final width (StoryRuntimeApp OutlineRail). Its
 * behaviour cannot live there: a document of pure prose — which is exactly
 * the kind that has sections — ships no runtime at all, so a React `onClick`
 * on those rows would never exist and the rail would be furniture. Measured:
 * the first browser gate clicked a row and nothing moved.
 *
 * So the rail is inert markup plus this: one delegated click listener, and a
 * scroll listener that marks the row whose heading was last crossed. Plain
 * DOM, one realm, works the same whether the document hydrates or not. A
 * hydrating document re-renders the rail on a live update; rows are keyed by
 * heading path so their DOM nodes survive, and the observer below re-marks
 * after any rebuild anyway.
 */
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';

export const OUTLINE_TARGET_ATTR = 'data-mx-target';

/** The rail's rows, and each one's heading in the DOCUMENT (never the rail's own text). */
function pairs(doc: Document): Array<{ row: HTMLElement; heading: HTMLElement | null }> {
  return [...doc.querySelectorAll<HTMLElement>(`.mx-outline-row[${OUTLINE_TARGET_ATTR}]`)].map((row) => ({
    row,
    heading: doc.querySelector<HTMLElement>(`.mx-doc [${AST_PATH_ATTR}="${row.getAttribute(OUTLINE_TARGET_ATTR)}"]`),
  }));
}

/** Wire the outline in `doc`. Returns a disposer. A no-op when the document has none. */
export function wireOutline(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};

  const onClick = (e: MouseEvent) => {
    const row = (e.target as Element | null)?.closest?.(`.mx-outline-row[${OUTLINE_TARGET_ATTR}]`) as HTMLElement | null;
    if (!row) return;
    const heading = doc.querySelector<HTMLElement>(`.mx-doc [${AST_PATH_ATTR}="${row.getAttribute(OUTLINE_TARGET_ATTR)}"]`);
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // The heading last crossed the upper third is the section being read.
  const mark = () => {
    const list = pairs(doc);
    if (!list.length) return;
    const line = win.innerHeight / 3;
    let active = 0;
    list.forEach(({ heading }, i) => { if (heading && heading.getBoundingClientRect().top <= line) active = i; });
    list.forEach(({ row }, i) => {
      if (i === active) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    });
  };

  doc.addEventListener('click', onClick);
  win.addEventListener('scroll', mark, { passive: true });
  win.addEventListener('resize', mark);
  /*
   * Watched from the BODY, not from the rail, and wired even when there is no
   * rail yet: a live update can turn a page into a sectioned document (an
   * agent adds headings), and it rebuilds the rows of one that already had an
   * outline. Binding to a rail that existed at load left the first case dead
   * and the second unmarked. The click handler is delegated on the document,
   * so it needs no rail to exist — only this re-mark does.
   */
  let queued = 0;
  const observer = new win.MutationObserver(() => {
    if (queued) return;
    queued = win.setTimeout(() => { queued = 0; mark(); }, 16);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  mark();

  return () => {
    doc.removeEventListener('click', onClick);
    win.removeEventListener('scroll', mark);
    win.removeEventListener('resize', mark);
    if (queued) win.clearTimeout(queued);
    observer.disconnect();
  };
}
