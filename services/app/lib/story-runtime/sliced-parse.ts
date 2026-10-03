/**
 * A compiled page parsed across tasks. A draft reply of a table-heavy document is megabytes of HTML, and one
 * `DOMParser` call over it was a single 60-80 ms task at slow CPUs, right when the reply landed. The page's own
 * streaming parser takes it in pieces instead: written into an inert document (no browsing context, so no script
 * runs and nothing loads) a few milliseconds at a time, yielding to input between pieces. Where that parser is not
 * available (a test DOM), one `DOMParser` call stands in.
 */
/** How long one piece may parse before the page gets the main thread back. */
export const PARSE_SLICE_MS = 8;
/** Characters written per `document.write`: small enough that a slice ends close to its budget. */
const CHUNK = 16 * 1024;

let streaming: boolean | null = null;
/** Whether an inert document's parser takes HTML written in pieces, as the browser's does (checked once). */
function canStream(doc: Document): boolean {
  if (streaming === null) {
    try {
      const probe = doc.implementation.createHTMLDocument('');
      probe.open();
      probe.write('<p data-mx-probe>a');
      probe.write('b</p>');
      probe.close();
      streaming = probe.querySelector('p[data-mx-probe]')?.textContent === 'ab';
    } catch { streaming = false; }
  }
  return streaming;
}

/** The next task: `scheduler.yield` where the browser has it (input first), a message otherwise (never clamped like a timer). */
export function nextTask(win: Window): Promise<void> {
  const scheduler = (win as Window & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new (win as Window & typeof globalThis).MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

/**
 * `html` parsed as a document, yielding between slices of about PARSE_SLICE_MS. `current` is asked after every
 * yield: once false (a newer draft arrived, editing ended) the parse stops and resolves null.
 */
export async function parseHtmlInSlices(win: Window, html: string, current: () => boolean): Promise<Document | null> {
  if (!canStream(win.document)) return new (win as Window & typeof globalThis).DOMParser().parseFromString(html, 'text/html');
  const doc = win.document.implementation.createHTMLDocument('');
  doc.open();
  for (let at = 0; at < html.length;) {
    const until = win.performance.now() + PARSE_SLICE_MS;
    do {
      // Never between the two halves of a surrogate pair.
      const end = Math.min(html.length, at + CHUNK - (/[\uD800-\uDBFF]/.test(html[at + CHUNK - 1] ?? '') ? 1 : 0));
      doc.write(html.slice(at, end));
      at = end;
    } while (at < html.length && win.performance.now() < until);
    if (at < html.length) {
      await nextTask(win);
      if (!current()) { doc.close(); return null; }
    }
  }
  doc.close();
  return doc;
}
