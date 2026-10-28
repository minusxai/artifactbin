/**
 * Internal: check.mjs's in-page slide measurement: text cut off by a slide or a clipping box inside
 * it, and text drawn over other text. Runs in the browser through page.evaluate, so it references
 * only its own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** Each laid-out data-af-slide at this viewport: text cut off by the slide or a clipping box inside
 * it, and text drawn over other text. */
export function slides() {
  const slides = [...document.querySelectorAll('[data-af-slide]')].filter(
    slide =>
      !slide.closest('[data-af-deck-chrome]') &&
      slide.getBoundingClientRect().width > 1 &&
      slide.getBoundingClientRect().height > 1
  );
  if (!slides.length) return null;
  const clipped = [],
    overlaps = [];
  slides.forEach((slide, index) => {
    const seen = new Set(),
      texts = [],
      walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (
        !el ||
        seen.has(el) ||
        n.textContent.trim().length < 2 ||
        el.closest('[data-af-deck-chrome]')
      )
        continue;
      seen.add(el);
      const s = getComputedStyle(el),
        r = el.getBoundingClientRect();
      if (s.visibility !== 'visible' || Number(s.opacity) === 0 || r.width < 1 || r.height < 1)
        continue;
      // Visually hidden text (sr-only tables, clipped boxes) is neither clipped nor overlapping;
      // chart libraries place SVG labels.
      let hidden = false;
      for (let e = el; e && !hidden && e !== slide.parentElement; e = e.parentElement) {
        const es = getComputedStyle(e),
          er = e.getBoundingClientRect();
        hidden = es.clip !== 'auto' || es.clipPath !== 'none' || er.width < 4 || er.height < 4;
      }
      if (hidden) continue;
      if (!el.closest('svg')) texts.push({el, r, text: n.textContent.trim().slice(0, 48)});
      for (let box = el; box; box = box === slide ? null : box.parentElement) {
        const b = box.getBoundingClientRect(),
          style = getComputedStyle(box);
        if (box !== slide && style.overflowX === 'visible' && style.overflowY === 'visible')
          continue;
        // An HTML box clips only content that overflows it; a tall display font's glyph box
        // poking past a hidden-overflow box is not a clip.
        if (
          box !== slide &&
          box instanceof HTMLElement &&
          box.scrollHeight <= box.clientHeight + 1 &&
          box.scrollWidth <= box.clientWidth + 1
        )
          continue;
        const by = Math.max(b.top - r.top, r.bottom - b.bottom, b.left - r.left, r.right - b.right);
        // A font's em box overhangs a tight line box without clipping visible glyphs; ignore
        // overhang within ~15% of the font size.
        if (by > Math.max(1, 0.15 * parseFloat(s.fontSize || '16'))) {
          clipped.push({
            slide: index + 1,
            text: n.textContent.trim().slice(0, 48),
            px: Math.round(by),
            by:
              box === slide
                ? 'slide'
                : box.tagName.toLowerCase() +
                  (box.className && typeof box.className === 'string'
                    ? '.' + box.className.trim().split(/\s+/)[0]
                    : '')
          });
          break;
        }
      }
    }
    // HTML text drawn over other HTML text (not nested), across at least 30% of the smaller box
    // each way; chart libraries place SVG labels.
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i],
          b = texts[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left),
          h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 0.3 * Math.min(a.r.width, b.r.width) && h > 0.3 * Math.min(a.r.height, b.r.height))
          overlaps.push({slide: index + 1, text: a.text, over: b.text});
      }
  });
  return {
    count: slides.length,
    clipped: clipped.length,
    items: clipped.slice(0, 100),
    overlapping: overlaps.length,
    overlaps: overlaps.slice(0, 100)
  };
}
