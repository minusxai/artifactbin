/**
 * Internal: check.mjs's in-page text contrast measurement (WCAG ratio of each text colour against
 * its resolved solid background). Runs in the browser through page.evaluate, so it references only
 * its own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** Text colour against its resolved solid background (WCAG ratio); agents without image input
 * cannot see contrast. */
export function contrast() {
  const parse = v => {
    const m = String(v).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1};
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1
  });
  const lum = c => {
    const f = x => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const background = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (/url\(/.test(s.backgroundImage)) return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (const c of layers.reverse()) base = over(c, base);
    return base;
  };
  const seen = new Set(),
    low = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || n.textContent.trim().length < 2) continue;
    seen.add(el);
    const s = getComputedStyle(el),
      rect = el.getBoundingClientRect();
    if (
      s.visibility !== 'visible' ||
      Number(s.opacity) === 0 ||
      rect.width < 2 ||
      rect.height < 2 ||
      s.backgroundClip === 'text'
    )
      continue;
    let fg = parse(s.color);
    const bg = background(el);
    if (!fg || !bg) continue;
    if (fg.a < 1) fg = over(fg, bg);
    checked++;
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x),
      ratio = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    const size = parseFloat(s.fontSize),
      need = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700) ? 3 : 4.5;
    if (ratio < need) {
      const slide = el.closest('[data-af-slide]');
      low.push({
        text: n.textContent.trim().slice(0, 48),
        ratio,
        need,
        color: s.color,
        fontSize: Math.round(size),
        element:
          el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/)[0]
            : ''),
        ...(slide
          ? {slide: [...document.querySelectorAll('[data-af-slide]')].indexOf(slide) + 1}
          : {})
      });
    }
  }
  low.sort((x, y) => x.ratio - y.ratio);
  return {
    checked,
    belowAA: low.length,
    unreadable: low.filter(item => item.ratio < 2).length,
    low: low.slice(0, 100)
  };
}
