/**
 * The font families a document ASKS FOR, and the CSS that makes the ask real.
 * PURE — the resolution (fetch, store) is lib/webfonts; this is the vocabulary
 * and the stylesheet, so publish and render agree on both by construction.
 *
 * The ask rides Helmet `<meta>`, which already exists and already round-trips:
 *
 *   <meta name="font-display" content="Lobster" />   headings
 *   <meta name="font-body"    content="Lora" />      body text
 *   <meta name="font-mono"    content="Fira Code" /> code
 *
 * A theme still supplies all three; these OVERRIDE it per slot, which is why
 * the override is a var block rather than a new theme — a document keeps its
 * theme's palette, radii and rules and changes only the face.
 */
import { FAMILY_RE } from '@/lib/webfonts';
import type { HelmetContent } from './helmet';

/** The three slots a document may override, in the order the head declares them. */
const FONT_SLOTS = ['font-display', 'font-body', 'font-mono'] as const;
export type FontSlot = (typeof FONT_SLOTS)[number];

export interface DocumentFonts {
  /** slot → family, only for slots the document actually named. */
  slots: Partial<Record<FontSlot, string>>;
  /** Distinct families, for resolution. */
  families: string[];
}

/** What this document asks for. Unnameable values are ignored here and rejected at the door. */
export function documentFonts(helmet: HelmetContent): DocumentFonts {
  const slots: Partial<Record<FontSlot, string>> = {};
  for (const slot of FONT_SLOTS) {
    const value = helmet.meta.find((m) => m.name === slot)?.content?.trim();
    if (value) slots[slot] = value;
  }
  return { slots, families: [...new Set(Object.values(slots))] };
}

/** The families a document names that are NOT valid family names — the door's 400. */
export function invalidFontFamilies(fonts: DocumentFonts): string[] {
  return fonts.families.filter((f) => !FAMILY_RE.test(f));
}

/**
 * The override: the vars AND the rules that consume them.
 *
 * Both halves are needed, and only a browser showed why: a THEMED document
 * already binds `--font-display` to headings and `--font-body` to the root
 * (story-themes.ts), so setting the var alone would have been enough there —
 * but a THEMELESS document emits no such rule, so the var sat unread and the
 * heading kept Tailwind's default sans stack while every other signal (the
 * @font-face rules, the preload, the var itself) said the font had arrived.
 *
 * Binding here too is safe for the themed case: this sheet is emitted after
 * the theme's, the declarations are identical in effect, and `:where()` keeps
 * the specificity at zero so an ordinary authored class still wins.
 */
export function documentFontCss(fonts: DocumentFonts): string {
  const named = FONT_SLOTS.filter((slot) => fonts.slots[slot]);
  if (named.length === 0) return '';
  const stack = (slot: FontSlot) => `"${fonts.slots[slot]}", var(--${slot}-fallback, sans-serif)`;
  const blocks = [`:root {\n${named.map((slot) => `  --${slot}: ${stack(slot)};`).join('\n')}\n}`];
  if (fonts.slots['font-body']) blocks.push(':where(:root) { font-family: var(--font-body); }');
  if (fonts.slots['font-display']) blocks.push(':where(:root) :is(h1, h2, h3, h4, h5, h6) { font-family: var(--font-display); }');
  if (fonts.slots['font-mono']) blocks.push(':where(:root) :is(code, pre, kbd, samp) { font-family: var(--font-mono); }');
  return blocks.join('\n');
}
