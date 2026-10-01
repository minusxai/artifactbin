/** The HTML-first reader reports its open before the Solid app is requested. */
const VIEW_REPORTED_ATTR = 'data-mx-view-reported';

export const initialViewWasReported = (doc: Document, id: string): boolean =>
  doc.body.getAttribute(VIEW_REPORTED_ATTR) === id;

export function reportInitialArtifactView(win: Window): void {
  const id = /^\/a\/([^/]+)$/.exec(win.location.pathname)?.[1];
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
