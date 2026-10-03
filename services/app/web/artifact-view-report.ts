/**
 * ONE VIEW PER DOCUMENT SHOWN: the app page reports the document it frames (solid/pages/Document) as it shows it —
 * on a first load and on every navigation that brings another document — and the starter its own (solid/pages/Starter).
 * The body remembers the document last reported, so showing the same one again in this page counts once.
 */
const VIEW_REPORTED_ATTR = 'data-mx-view-reported';

export const initialViewWasReported = (doc: Document, id: string): boolean =>
  doc.body.getAttribute(VIEW_REPORTED_ATTR) === id;

export function reportArtifactView(win: Window, id: string): void {
  if (!id || initialViewWasReported(win.document, id)) return;
  const report = () => {
    if (initialViewWasReported(win.document, id)) return;
    win.document.body.setAttribute(VIEW_REPORTED_ATTR, id);
    void win.fetch(`/api/page/artifact/${encodeURIComponent(id)}/view`, {
      method: 'POST', credentials: 'same-origin', keepalive: true,
    }).catch(() => {});
  };
  // A prerendered linked page becomes a view only when it is activated.
  if ((win.document as Document & { prerendering?: boolean }).prerendering) {
    win.document.addEventListener('prerenderingchange', report, { once: true });
  } else report();
}
