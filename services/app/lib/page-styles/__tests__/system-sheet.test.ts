import { describe, expect, it } from 'vitest';
import { storySystemSheetCss } from '@/lib/story-design/server';
import { documentStyleSheets } from '../document-styles';
import { storyBaseCss } from '../story-base-css';

describe('a design system\'s sheet in the served styles', () => {
  it('the base sheet and the standalone document carry the system\'s faces and classes, after the fonts and before the author', () => {
    const fonts = { slots: {}, families: [] };
    const bare = storyBaseCss({ chrome: true, theme: 'volta', fonts });
    expect(bare).not.toContain('.t-label');
    const dressed = storyBaseCss({ chrome: true, theme: 'volta', fonts, systemCss: storySystemSheetCss('volta') });
    expect(dressed).toContain('@font-face { font-family: "Bricolage Grotesque"');
    expect(dressed).toContain(':where(:root[data-theme="volta"]) .t-label {');
    const sheets = documentStyleSheets({ compiledCss: null, chrome: true, bare: false, theme: 'volta', docFonts: fonts, systemCss: storySystemSheetCss('volta'), authorCss: ':root { --ds-volt: red }' });
    const attrs = sheets.map((s) => s.attr);
    expect(attrs.indexOf('data-mx-system')).toBeGreaterThan(attrs.indexOf('data-mx-fonts'));
    expect(attrs.indexOf('data-mx-system')).toBeLessThan(attrs.indexOf('data-mx-author'));
    expect(documentStyleSheets({ compiledCss: null, chrome: true, bare: false, theme: 'modernist', docFonts: fonts, systemCss: storySystemSheetCss('modernist'), authorCss: null }).map((s) => s.attr)).not.toContain('data-mx-system');
  });
});
