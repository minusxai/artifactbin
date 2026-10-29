/** lib/story-design through its index: the runtime-class rule, the font faces and the themes a stored row resolves to. */
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_CLASS_LIMIT, STORY_FAMILY_ASSETS, STORY_FONTS_ATTR, STORY_THEMES, getStoryFontCss, isRuntimeClassToken,
  resolveStoredStoryDesign, storyFontFaceCss,
} from '..';

describe('isRuntimeClassToken', () => {
  it('admits utilities, variants, arbitrary values and either case', () => {
    for (const token of ['flex', 'hover:bg-sky-600', 'w-[37%]', '[&>p]:mt-3', '!mt-0', '-mx-6', 'Upper']) expect(isRuntimeClassToken(token), token).toBe(true);
  });

  it('refuses anything that could close a rule or a tag, and the empty and overlong token', () => {
    for (const token of ['', 'a b', 'x;y', 'a{b}', '"q"', "it's", '<b>', 'a\\b', 'x'.repeat(121)]) expect(isRuntimeClassToken(token), token).toBe(false);
    expect(isRuntimeClassToken('x'.repeat(120))).toBe(true);
  });

  it('caps a sheet at one request\'s worth of classes', () => {
    expect(RUNTIME_CLASS_LIMIT).toBe(500);
  });
});

describe('fonts', () => {
  const asset = { family: 'Ink "Sans"', url: '/fonts/ink.0123abcd.woff2', weight: '400 700', style: 'normal', unicodeRange: 'U+0000-00FF' };

  it('writes one swap @font-face per asset, omitting absent descriptors', () => {
    expect(storyFontFaceCss([])).toBe('');
    const css = storyFontFaceCss([asset, { ...asset, weight: '', style: '', unicodeRange: undefined }]);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-family: "Ink "Sans"";\n  src: url("/fonts/ink.0123abcd.woff2") format("woff2");\n  font-weight: 400 700;');
    expect(css.split('@font-face')[2]).not.toMatch(/font-weight|font-style|unicode-range/);
    expect(css.match(/font-display: swap;/g)).toHaveLength(2);
  });

  it('serves a theme its own families, and every bundled family for no theme or an unknown one', () => {
    const all = Object.values(STORY_FAMILY_ASSETS).flat().length;
    expect(all).toBeGreaterThan(0);
    for (const assets of Object.values(STORY_FAMILY_ASSETS)) for (const a of assets) expect(a.url).toMatch(/^\/fonts\/[a-z0-9-]+\.[a-f0-9]{8}\.woff2$/);
    expect(getStoryFontCss().match(/@font-face/g)).toHaveLength(all);
    expect(getStoryFontCss('no-such-theme')).toBe(getStoryFontCss());
    const themed = getStoryFontCss('terminal');
    expect(themed.length).toBeGreaterThan(0);
    expect(themed.match(/@font-face/g)!.length).toBeLessThan(all);
    expect(STORY_FONTS_ATTR).toBe('data-mx-fonts');
  });
});

describe('themes', () => {
  it('registers the six themes by name', () => {
    expect(STORY_THEMES.map((t) => t.name)).toEqual(['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop']);
  });

  it('resolves a stored theme or design system, and turns an unknown name into unthemed', () => {
    expect(resolveStoredStoryDesign('organic', 'dark')).toEqual({ theme: 'organic', colorMode: 'dark' });
    expect(resolveStoredStoryDesign('volta', undefined)).toEqual({ theme: 'volta', colorMode: null });
    expect(resolveStoredStoryDesign('retired-theme', 'light')).toEqual({ theme: null, colorMode: 'light' });
    expect(resolveStoredStoryDesign(null, null)).toEqual({ theme: null, colorMode: null });
  });
});
