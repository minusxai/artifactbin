import { markScrollableTables } from '../islands/table-scroll';

type TableScrollOwner = { dispose: () => void };
const ownerKey = Symbol.for('artifactbin.native-html-table-scroll-owner');

/** Start the document-level table affordance once the parsed body exists. */
export function startNativeHtmlTableScroll(doc: Document = document): () => void {
  const owned = doc as Document & { [ownerKey]?: TableScrollOwner };
  owned[ownerKey]?.dispose();

  let stopWatching: (() => void) | undefined;
  let disposed = false;
  const start = () => {
    if (!disposed && !stopWatching && doc.body) stopWatching = markScrollableTables(doc);
  };
  const pause = () => { stopWatching?.(); stopWatching = undefined; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pause();
    doc.removeEventListener('DOMContentLoaded', start);
    doc.defaultView?.removeEventListener('pagehide', pause);
    doc.defaultView?.removeEventListener('pageshow', start);
    if (owned[ownerKey]?.dispose === dispose) delete owned[ownerKey];
  };

  owned[ownerKey] = { dispose };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  doc.defaultView?.addEventListener('pagehide', pause);
  doc.defaultView?.addEventListener('pageshow', start);
  return dispose;
}
