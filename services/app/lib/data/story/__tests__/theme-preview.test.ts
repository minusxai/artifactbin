/**
 * Theme preview generation — the sample document each picker card shows.
 *
 * `scripts/generate-theme-previews.ts` screenshots `buildThemePreviewDocument`
 * per theme × mode into public/story-themes/<name>[-dark].png. These tests pin
 * the document shape so the driver only ever photographs a real, chromeless,
 * correctly-moded document built through the REAL pipeline (compileStoryCss +
 * buildStoryDocument) — not a hand-rolled approximation that could drift.
 */
import { describe, it, expect } from 'vitest';
import { STORY_THEMES } from '../story-themes';
import { buildThemePreviewDocument, themePreviewMarkup } from '../theme-preview';

describe('themePreviewMarkup', () => {
  it('is one static design-system sample exercising the personality surface', () => {
    for (const t of STORY_THEMES) {
      const markup = themePreviewMarkup(t.name);
      expect(markup).toContain('data-design="tw"');
      // The tokens a theme differs by: accent, rules, quote, table header —
      // and the full palette as a swatch strip (chart ramp included).
      expect(markup).toContain('bg-primary');
      for (const token of ['bg-secondary', 'bg-accent', 'bg-destructive', 'bg-chart-1', 'bg-chart-5']) {
        expect(markup, token).toContain(token);
      }
      expect(markup).toContain('<hr');
      expect(markup).toContain('<blockquote');
      expect(markup).toContain('<th');
      // Static only — a preview must render without DuckDB, hydration or refs.
      expect(markup).not.toContain('<Query');
      expect(markup).not.toContain('<Question');
      expect(markup).not.toContain('ref:');
    }
  });
});

describe('buildThemePreviewDocument', () => {
  it('builds a chromeless document stamped with the theme and the requested mode', async () => {
    const html = await buildThemePreviewDocument('terminal', 'dark');
    expect(html).toContain('data-theme="terminal"');
    expect(html).toMatch(/<html[^>]*class="dark"/);
    // The REAL sheet, dark block included — the screenshot shows the palette.
    expect(html).toContain(':root:where([data-theme="terminal"].dark)');
    // Chromeless: no credits footer, no live stream — this is a photograph.
    expect(html).not.toContain('mx-artifact-credits');
  });

  it('renders the light mode of a dark-default theme when asked', async () => {
    const html = await buildThemePreviewDocument('terminal', 'light');
    expect(html).toMatch(/<html[^>]*class="light"/);
  });
});
