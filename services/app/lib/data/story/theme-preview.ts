/**
 * Theme preview documents — what the picker cards photograph.
 *
 * ONE canonical sample (eyebrow, display heading, prose, quote, rule, a small
 * table, an accent chip) rendered through the REAL pipeline: compileStoryCss
 * for the sheet, buildStoryDocument for the page, `colorMode` riding the real
 * mode resolution. The driver (scripts/generate-theme-previews.ts) screenshots
 * the result per theme × mode into public/story-themes/<name>[-dark].png; a
 * registry tweak then only needs `npm run generate:theme-previews` to keep
 * every card honest.
 *
 * Deliberately STATIC: no <Query>/<Question>, no refs — a preview must render
 * without DuckDB, hydration or a data store, and its first paint is its final
 * geometry.
 */
import { buildStoryDocument } from '@/lib/story/document';
import { compileStoryCss } from './story-css.server';
import type { StoryThemeName } from './story-themes';

/** The palette tokens the swatch strip shows, in reading order: the working colors first, then the chart ramp. */
const SWATCH_TOKENS = ['primary', 'secondary', 'accent', 'muted', 'destructive'] as const;
const CHART_TOKENS = [1, 2, 3, 4, 5] as const;

/** The canonical sample every theme renders — identical markup, so the cards differ only by design. */
export function themePreviewMarkup(theme: StoryThemeName): string {
  // The swatch strip: every palette token as a rect, so a card shows the whole
  // color system at a glance — not just the accent the sample happens to spend.
  const swatches = [
    ...SWATCH_TOKENS.map((t) => `<span className="h-6 flex-1 rounded-sm bg-${t}"></span>`),
    ...CHART_TOKENS.map((n) => `<span className="h-6 flex-1 rounded-sm bg-chart-${n}"></span>`),
  ].join('');
  return `<div data-design="tw" className="@container min-h-screen bg-background p-8 text-foreground">
  <p className="text-xs uppercase tracking-widest font-semibold text-primary">Theme · ${theme}</p>
  <h1 className="mt-2 text-4xl font-bold tracking-tight">The quick brown fox</h1>
  <p className="mt-3 max-w-prose text-sm text-muted-foreground">Every theme carries a light and a dark palette over the same document — type, rules, tables and one accent doing the talking.</p>
  <div className="mt-4 flex gap-1.5" aria-hidden="true">${swatches}</div>
  <hr className="my-4" />
  <table className="w-full text-sm">
    <thead><tr className="border-b border-border text-left"><th className="py-1 pr-4">Series</th><th className="py-1">Value</th></tr></thead>
    <tbody>
      <tr className="border-b border-border"><td className="py-1 pr-4">Alpha</td><td className="py-1">1,204</td></tr>
      <tr><td className="py-1 pr-4">Beta</td><td className="py-1">86%</td></tr>
    </tbody>
  </table>
  <div className="mt-5 flex items-center gap-6">
    <blockquote className="text-sm">Design is the silent ambassador.</blockquote>
    <span className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">accent</span>
  </div>
</div>`;
}

/**
 * A complete, chromeless, self-contained preview document for one theme in one
 * mode — exactly what a reader would be served, minus runtime, live stream and
 * credits (a photograph has none of those).
 */
export async function buildThemePreviewDocument(theme: StoryThemeName, mode: 'light' | 'dark'): Promise<string> {
  const source = themePreviewMarkup(theme);
  const compiledCss = await compileStoryCss(source, { force: true });
  return buildStoryDocument({
    source,
    compiledCss,
    theme,
    // The explicit author default: rides the real resolution, so the document
    // opens in the requested mode regardless of the theme's own default.
    colorMode: mode,
    refData: {},
    title: null,
    chrome: false,
  });
}
