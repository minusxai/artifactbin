/**
 * THE ENGINE'S DRAWING CARRIES THE PAGE'S FONTS. The kit shows every Mermaid
 * drawing as an `<img>` of an SVG, and an image cannot reach the page's web
 * fonts: without this, an engine drawing's text renders in whatever the
 * reader's machine resolves the stack to, while a stored drawing (which
 * carries subsets of the same faces, lib/mermaid-images/fonts) shows the
 * theme's face. So the kit puts the face files the page already loaded — its
 * own @font-face rules; the bytes come from the HTTP cache — into the drawing,
 * whole, as `data:` URLs, one leading stylesheet, with the stored drawing's
 * unhinted-text rule. The same planner decides
 * which files (lib/mermaid-images/svg-text), so a drawing the harvest would
 * not store (a system font, a synthesized bold) carries nothing here either
 * and draws as before. Whole files, not subsets: a subsetter in the reader
 * would cost ~645KB gzipped (hb-subset and woff2 WebAssembly); the files are
 * already in the cache (Inter 73KB, JetBrains Mono 40KB, Noto Serif 14KB).
 */
import { MERMAID_TEXT_RENDERING, planFontFiles, type FontFile } from '@/lib/mermaid-images/svg-text';

/** A face the page declares: its family, file, weight (or range) and range of characters. */
interface PageFontFace extends FontFile { family: string }

const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, '');

/** One @font-face's descriptors, from the parsed rule or from its source text. */
function faceOf(get: (name: string) => string): PageFontFace | null {
  const style = get('font-style').trim();
  if (style && style !== 'normal') return null;
  const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(get('src'))?.[1];
  const family = unquote(get('font-family'));
  if (!url || !family) return null;
  return { family, url, weight: get('font-weight').trim() || '400', unicodeRange: get('unicode-range').trim() || null };
}

/**
 * The page's own upright @font-face rules: as the browser parsed them, and —
 * for inline sheets, whose text is at hand — as written (a DOM without a full
 * CSS parser keeps only some descriptors). Unreadable sheets are skipped.
 */
export function pageFontFaces(doc: Document = document): PageFontFace[] {
  const faces = new Map<string, PageFontFace>();
  const add = (face: PageFontFace | null) => { if (face) faces.set(`${face.family}\0${face.url}\0${face.weight}`, face); };
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === 5 /* CSSRule.FONT_FACE_RULE */) add(faceOf((name) => (rule as CSSFontFaceRule).style.getPropertyValue(name)));
      else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* a cross-origin sheet: not ours to read */ }
  }
  for (const element of Array.from(doc.querySelectorAll('style'))) {
    for (const block of (element.textContent ?? '').matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const declarations = new Map<string, string>();
      for (const part of block[1]!.split(';')) {
        const colon = part.indexOf(':');
        if (colon > 0) declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
      }
      add(faceOf((name) => declarations.get(name) ?? ''));
    }
  }
  return [...faces.values()];
}

/** The file as a `data:` URL, read once per page (from the HTTP cache: the page loaded it). */
const loaded = new Map<string, Promise<string>>();
function pageFontData(url: string): Promise<string> {
  let found = loaded.get(url);
  if (!found) {
    // As the page's @font-face loaded it — CORS, no credentials — so the HTTP cache answers (measured in
    // Chromium: a credentialed read of the same file misses the cache on the app's page).
    found = fetch(url, { cache: 'force-cache', mode: 'cors', credentials: 'omit' }).then(async (response) => {
      if (!response.ok) throw new Error(`font ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      return `data:font/woff2;base64,${btoa(binary)}`;
    });
    found.catch(() => loaded.delete(url));
    loaded.set(url, found);
  }
  return found;
}

/**
 * The drawing carrying the page's faces it is drawn in, as one leading
 * stylesheet; null when it cannot carry them (then it draws as before).
 */
export async function embedPageFonts(
  svg: string, faces: { label: string; edge: string }, declared: readonly PageFontFace[],
  fontData: (url: string) => Promise<string> = pageFontData,
): Promise<string | null> {
  const open = /^<svg\b[^>]*>/.exec(svg);
  if (!open) return null;
  const plan = planFontFiles(svg, faces, (family) => declared.filter((face) => face.family === family));
  if (!plan) return null;
  try {
    const rules: string[] = [];
    for (const file of plan) {
      const data = await fontData(file.url);
      if (!/^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
      // As the page declares it: the file's own weight (a range for a variable file), and its range of characters.
      for (const face of declared.filter((face) => face.family === file.family && face.url === file.url)) {
        rules.push(`@font-face{font-family:"${file.family}";src:url(${data}) format("woff2");font-weight:${face.weight};font-style:normal${face.unicodeRange ? `;unicode-range:${face.unicodeRange}` : ''}}`);
      }
    }
    // Unhinted, as a stored drawing renders its text: the two look alike wherever the layouts agree.
    return `${open[0]}<style>${rules.join('')}${MERMAID_TEXT_RENDERING}</style>${svg.slice(open[0].length)}`;
  } catch {
    return null;
  }
}
