/** The server names the framing app on documents served from their own origin. */
export const APP_ORIGIN_ATTR = 'data-mx-app-origin';

/** Without the attribute, only the document's own origin may drive it. */
export function frameAppOrigin(doc: Document, win: Window): string {
  return doc.documentElement.getAttribute(APP_ORIGIN_ATTR) || win.location.origin;
}
