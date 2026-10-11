/**
 * THE DOCUMENT'S STYLESHEETS, WITH THE SHARED ONES LINKED.
 *
 * `documentStyleSheets` (lib/page-styles/document-styles) is the standalone document's CSS byte for byte, ~200 KB of it inline in
 * every document, 99% of it the same text for every document of a build. A document on its own origin
 * (APP__PAGES_HOST) links what it shares instead — each text an immutable, content-addressed stylesheet
 * (`/islands/c/<sha>.css`, lib/compiled-page createStylesheetStore) on the APP's origin, so one URL serves every document
 * and the second document's first view fetches none of it — and carries inline only what is its own:
 *
 *   data-mx-tw-s0 …  link   the union's Tailwind, in shards (lib/page-styles/story-css-split), the document's own rules between
 *   data-mx-tw-i0 …  inline the rules it added where the cascade needs them there, and at the end where it does not
 *   data-mx-base     link   every theme's tokens, the bare element sheets, the chrome, the embeds, the theme's faces
 *   data-mx-font-vars inline the Helmet's font slots (its own, and the one that must follow the faces)
 *   data-mx-system   link   the design system's faces and classes
 *   data-mx-author   inline the author's CSS, last, so it sees everything it may override
 *
 * Same sheets, same order, same rules: only where the text is served from changes. The faces the shared sheets
 * declare are `/fonts/…` URLs, which resolve against the sheet's origin (the app's), so the assembler preloads them
 * from there and the policy admits that path (lib/page-styles/document-csp). The standalone sheets for a capture, the offline file
 * and the draft preview are `documentStyleSheets` itself: they never go through here.
 */
import type { stylesheetStore } from '@/lib/compiled-page';
import { storyCssCompileVersion, unionStoryCss } from '@/lib/data/story/story-css.server';
import { storyThemeCss } from '@/lib/data/story/story-themes';
import { STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';
import { splitStoryCss, storyCssBase, type DocumentSheet, type StoryCssBase } from '@/lib/page-styles';

/** The sheets that are the same text for every document of a theme: one base sheet, in this order, behind the Tailwind. */
const BASE_ATTRS = new Set(['data-mx-bare-type', 'data-mx-bare-controls', 'data-mx-task-checkbox', 'data-mx-chrome', 'data-mx-embed', 'data-mx-tables', 'data-mx-column', STORY_FONTS_ATTR]);
/** The sheets that are the same text for every document that names one design system. */
const SYSTEM_ATTR = 'data-mx-system';
const TAILWIND_ATTR = 'data-mx-tw';

// eslint-disable-next-line no-restricted-syntax -- process-lifetime memo of one build's union, keyed by its environment version; no per-request scope
let memo: { version: string; base: Promise<StoryCssBase | null> } | null = null;
/** The union the documents of this build are compared with, once per compile environment. */
function currentBase(): Promise<StoryCssBase | null> {
  const version = storyCssCompileVersion();
  if (memo?.version !== version) {
    const base = unionStoryCss().then((union) => storyCssBase(union, storyThemeCss()));
    base.catch(() => { if (memo?.base === base) memo = null; });
    memo = { version, base };
  }
  return memo.base;
}

interface LinkTarget {
  /** The origin the sheets are linked from (the app's). */
  origin: string;
  /** Where a shared sheet is kept under its content address (lib/compiled-page createStylesheetStore). */
  store: Pick<ReturnType<typeof stylesheetStore>, 'put'>;
}

/** `sheets` (documentStyleSheets) with every shared one linked from `target.origin`. */
export async function linkedDocumentSheets(sheets: readonly DocumentSheet[], target: LinkTarget): Promise<DocumentSheet[]> {
  const { store } = target;
  const origin = target.origin.replace(/\/+$/, '');
  const link = async (attr: string, css: string): Promise<DocumentSheet> => ({ attr, css, href: `${origin}${await store.put(css)}` });

  const out: DocumentSheet[] = [];
  let pending: string[] = [];
  const flushBase = async (): Promise<void> => {
    if (!pending.length) return;
    out.push(await link('data-mx-base', pending.join('\n')));
    pending = [];
  };

  for (const sheet of sheets) {
    if (sheet.attr === TAILWIND_ATTR) {
      const base = await currentBase();
      const segments = base ? splitStoryCss(sheet.css, base) : null;
      if (!base || !segments) { out.push(sheet); continue; }
      let inline = 0;
      for (const segment of segments) {
        out.push('shard' in segment ? await link(`data-mx-tw-s${segment.shard}`, base.shards[segment.shard]!) : { attr: `data-mx-tw-i${inline++}`, css: segment.inline });
      }
      // Every compile ends with the themes' tokens: the same text in every document, first in the base sheet.
      pending.push(base.themes);
    } else if (BASE_ATTRS.has(sheet.attr)) {
      pending.push(sheet.css);
    } else if (sheet.attr === SYSTEM_ATTR) {
      await flushBase();
      out.push(await link(SYSTEM_ATTR, sheet.css));
    } else {
      await flushBase();
      out.push(sheet);
    }
  }
  await flushBase();
  return out;
}
