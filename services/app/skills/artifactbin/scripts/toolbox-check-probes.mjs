/**
 * Internal: check.mjs's in-page measurements of a settled page: layout settling, page-width
 * overflow and duplicate data-af-id values. Each runs in the browser through page.evaluate, so it
 * references only its own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** Settled layout: fonts loaded, transitions done, then layout unchanged across two frames. */
export async function layout() {
  const within = (promise, ms) =>
    Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);
  const frames = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await within(document.fonts?.ready, 1500);
  await within(
    Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))),
    1000
  );
  const shape = () =>
    [document.body.scrollWidth, document.body.scrollHeight]
      .concat(
        [...document.querySelectorAll('[data-af-slide], [data-af-slide] svg')]
          .slice(0, 200)
          .map(node => {
            const box = node.getBoundingClientRect();
            return `${Math.round(box.left)},${Math.round(box.top)},` +
              `${Math.round(box.width)},${Math.round(box.height)}`;
          })
      )
      .join('|');
  let last = null;
  for (const end = Date.now() + 1500; Date.now() < end; ) {
    await frames();
    const now = shape();
    if (now === last) break;
    last = now;
  }
}

/** Whether the page fits its width, naming the outermost elements that stick out. */
export function overflow(html) {
  const content = Math.max(html.scrollWidth, html.ownerDocument.body.scrollWidth),
    fits = content <= html.clientWidth + 1;
  // Name the outermost elements that stick out, so a page-width overflow points at its cause.
  const name = e =>
    e.tagName.toLowerCase() +
    (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim()
      ? '.' + e.className.trim().split(/\s+/)[0]
      : '');
  const wide = fits
    ? []
    : [...html.ownerDocument.body.querySelectorAll('*')].filter(
        e =>
          e.getBoundingClientRect().right > html.clientWidth + 1 &&
          !(
            e.parentElement &&
            e.parentElement !== html.ownerDocument.body &&
            e.parentElement.getBoundingClientRect().right > html.clientWidth + 1
          )
      );
  return {
    viewport: html.clientWidth,
    content,
    fits,
    ...(wide.length
      ? {
          culprits: wide
            .slice(0, 3)
            .map(e => ({element: name(e), right: Math.round(e.getBoundingClientRect().right)}))
        }
      : {})
  };
}

/** Duplicate data-af-id values in the live DOM: comments and edits address elements by this ID. */
export function ids(html) {
  const counts = new Map();
  for (const node of html.ownerDocument.querySelectorAll('[data-af-id]')) {
    const id = node.getAttribute('data-af-id');
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const duplicated = [...counts].filter(([, count]) => count > 1);
  return {
    total: counts.size,
    duplicates: duplicated.length,
    items: duplicated.slice(0, 5).map(([id, count]) => ({id, count}))
  };
}
