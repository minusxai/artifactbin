/**
 * The faces a document's FIRST SCREEN paints — each one worth a
 * `<link rel="preload">` in the head, and nothing else is.
 *
 * Both directions cost a reader. A face the first screen paints but the head
 * does not name is discovered only after the stylesheet parses and the text
 * lays out, and the heading repaints when it lands (production: LCP a second
 * after FCP, on the same H1). A face the head names that nothing paints is
 * bytes racing the ones that are needed — and declaring faces is free, since a
 * browser fetches a declared face only for text that uses it, so the
 * declaration is not the signal: the document's text is.
 *
 * Read on the server from the parsed nodes both reader paths render (the app
 * page's inline story and the served /raw document), in document order up to a
 * first screen's worth of text:
 *   - a heading (h1–h6) paints the DISPLAY slot;
 *   - code, pre, kbd, samp, a `font-mono` utility and a `<Question>` title paint MONO;
 *   - any other text paints BODY;
 *   - `font-sans` / `font-serif` are the system stacks in a story: no face;
 *   - em, i, cite, dfn, var, address, `italic`, and the tags a theme sets
 *     italic (manuscript's blockquote) ask for the italic file where the family
 *     ships one; `not-italic` undoes it.
 * Each slot resolves to the document's own `font-*` meta (lib/story/styles/document-fonts)
 * or the theme's family; a themeless document paints the system stacks. Only
 * the latin file is named — the other subsets are unicode-range lazy.
 *
 * Text a first screen does not render is not counted: `hidden`, Helmet head
 * content, a conditional branch, and the closed parts of a disclosure (a tab
 * panel, an accordion or dialog body).
 */
import { escapeHtml } from '@artifactbin/utils/escape';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { STORY_FAMILY_ASSETS, type StoryFontAsset } from '@/lib/data/story/story-fonts';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import type { DocumentFonts } from './document-fonts';

type Slot = 'display' | 'body' | 'mono';
type Style = 'normal' | 'italic';

export interface FirstScreenFontsInput {
  theme?: string | null;
  nodes: JsxNode[];
  /** The document's `font-*` metas — each replaces its slot's family. */
  docFonts?: DocumentFonts;
  /** The imported families' faces (lib/webfonts), already resolved. */
  importedFaces?: readonly StoryFontAsset[];
}

/**
 * About a first screen of prose at the reader's column width. Text past it
 * still loads its face when it lays out; it just does not earn a preload.
 */
const FIRST_SCREEN_CHARS = 1200;
/** A reactive value renders text whose length is not known here. */
const EXPRESSION_CHARS = 8;

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const MONO_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);
const ITALIC_TAGS = new Set(['em', 'i', 'cite', 'dfn', 'var', 'address']);
/** Nothing inside is painted as text. */
const SKIPPED_TAGS = new Set(['helmet', 'head', 'title', 'meta', 'link', 'style', 'script', 'template', 'noscript', 'svg', 'math', 'iframe', 'video', 'audio', 'canvas', 'img']);
/** The closed part of a disclosure: unmounted, or hidden, until a reader opens it. */
const CLOSED_COMPONENTS = new Set([
  'TabsContent', 'AccordionContent', 'CollapsibleContent', 'DialogContent', 'PopoverContent',
  'TooltipContent', 'HoverCardContent', 'DropdownMenuContent', 'SheetContent', 'SelectContent',
  'AlertDialogContent', 'DrawerContent',
]);
/** Component props a kit component sets as text, in the body face unless named below. */
const TEXT_PROPS = new Set(['title', 'label', 'description', 'caption']);
/** Components that set a text prop in the mono face. */
const MONO_TITLE_COMPONENTS = new Set(['Question']);

/** Tags a theme's structural CSS sets italic (`& blockquote { font-style: italic }`). */
const THEME_ITALIC_TAGS: Record<string, ReadonlySet<string>> = Object.fromEntries(STORY_THEMES.map((t) => [
  t.name,
  new Set([...(t.css ?? '').matchAll(/&\s+([a-z][a-z0-9]*)\s*\{[^}]*font-style:\s*italic/g)].map((m) => m[1])),
]));

interface Context { slot: Slot | null; italic: boolean }

const staticString = (el: JsxElement, name: string): string | null => {
  const v = el.attributes.find((a) => a.name === name)?.value;
  return v?.static && typeof v.json === 'string' ? v.json : null;
};
const classTokens = (el: JsxElement): string[] => (staticString(el, 'className') ?? staticString(el, 'class') ?? '').split(/\s+/).filter(Boolean);

/** Which (slot, style) pairs the first screen paints. */
function paintedSlots(nodes: JsxNode[], theme: string | null | undefined): Set<`${Slot}:${Style}`> {
  const used = new Set<`${Slot}:${Style}`>();
  const themeItalic = (theme && THEME_ITALIC_TAGS[theme]) || new Set<string>();
  let budget = FIRST_SCREEN_CHARS;
  const paint = (ctx: Context, chars: number, slot: Slot | null = ctx.slot) => {
    if (chars <= 0 || budget <= 0) return;
    budget -= chars;
    if (slot) used.add(`${slot}:${ctx.italic ? 'italic' : 'normal'}`);
  };
  const walk = (list: JsxNode[], ctx: Context) => {
    for (const node of list) {
      if (budget <= 0) return;
      if (node.type === 'text') { paint(ctx, node.value.trim().length); continue; }
      if (node.type === 'expression') {
        const v = node.value;
        if (v.static) { if (typeof v.json === 'string' || typeof v.json === 'number') paint(ctx, String(v.json).trim().length); }
        else paint(ctx, EXPRESSION_CHARS);
        continue;
      }
      const el = node;
      // A conditional branch may not render; its fragments always do.
      if (el.control && el.control.kind !== 'fragment') continue;
      const tag = el.isComponent ? el.tag : el.tag.toLowerCase();
      if (!el.isComponent && SKIPPED_TAGS.has(tag)) continue;
      if (el.isComponent && (tag === 'Helmet' || CLOSED_COMPONENTS.has(tag))) continue;
      const classes = classTokens(el);
      if (el.attributes.some((a) => a.name === 'hidden') || classes.includes('hidden')) continue;
      const next: Context = { ...ctx };
      if (!el.isComponent && HEADINGS.has(tag)) next.slot = 'display';
      if (!el.isComponent && MONO_TAGS.has(tag)) next.slot = 'mono';
      if (classes.includes('font-mono')) next.slot = 'mono';
      else if (classes.includes('font-sans') || classes.includes('font-serif')) next.slot = null;
      if (!el.isComponent && (ITALIC_TAGS.has(tag) || themeItalic.has(tag))) next.italic = true;
      if (classes.includes('italic')) next.italic = true;
      if (classes.includes('not-italic')) next.italic = false;
      if (el.isComponent) {
        for (const prop of TEXT_PROPS) {
          const text = staticString(el, prop);
          if (text) paint(next, text.trim().length, MONO_TITLE_COMPONENTS.has(tag) && prop === 'title' ? 'mono' : next.slot);
        }
      }
      walk(el.children, next);
    }
  };
  walk(nodes, { slot: 'body', italic: false });
  return used;
}

/** The family a slot is set in: the document's meta, else the theme's; a themeless slot is the system stack. */
function familyFor(slot: Slot, theme: string | null | undefined, docFonts?: DocumentFonts): string | null {
  const own = docFonts?.slots[`font-${slot}`];
  if (own) return own;
  const t = STORY_THEMES.find((entry) => entry.name === theme);
  if (!t) return null;
  // story-themes binds --font-mono to the body family where a theme has no mono.
  return slot === 'mono' ? (t.fonts.mono ?? t.fonts.body) : t.fonts[slot];
}

/** The latin file a family paints a style in: its italic where it ships one, else the upright (a synthesized slant). */
function latinFace(family: string, style: Style, importedFaces: readonly StoryFontAsset[]): StoryFontAsset | null {
  const bundled = STORY_FAMILY_ASSETS[family];
  if (bundled) {
    const upright = bundled.find((a) => a.preload === true);
    if (!upright) return null;
    if (style === 'italic') return bundled.find((a) => a.style === 'italic' && a.unicodeRange === upright.unicodeRange) ?? upright;
    return upright;
  }
  // An imported family is copied with its latin upright flagged (lib/webfonts).
  return importedFaces.find((a) => a.family === family && a.preload === true) ?? null;
}

function facesFor(pairs: Iterable<`${Slot}:${Style}`>, input: Omit<FirstScreenFontsInput, 'nodes'>): StoryFontAsset[] {
  const faces = new Map<string, StoryFontAsset>();
  for (const pair of pairs) {
    const [slot, style] = pair.split(':') as [Slot, Style];
    const family = familyFor(slot, input.theme, input.docFonts);
    const face = family ? latinFace(family, style, input.importedFaces ?? []) : null;
    if (face && !faces.has(face.url)) faces.set(face.url, face);
  }
  return [...faces.values()];
}

/** The faces the first screen of these nodes paints, one per file. */
export function firstScreenFonts(input: FirstScreenFontsInput): StoryFontAsset[] {
  return facesFor(paintedSlots(input.nodes, input.theme), input);
}

/**
 * The head tags for font preloads. `crossorigin` is load-bearing: a font is
 * always fetched in CORS mode, and a preload without it warms an entry the
 * real request cannot use — the font would download twice.
 */
export function fontPreloadTags(urls: readonly string[], highPriority = false): string {
  return [...new Set(urls)].map((url) => `<link ${highPriority ? 'fetchpriority="high" ' : ''}rel="preload" href="${escapeHtml(url)}" as="font" type="font/woff2" crossorigin>`).join('');
}
