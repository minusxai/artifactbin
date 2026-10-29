/** lib/story-design's server entry: the story CSS compile and the design systems' sheets. One Tailwind compile per input. */
import { describe, expect, it } from 'vitest';
import { STORY_SYSTEM_NAMES } from '@/lib/validation';
import {
  STORY_SYSTEM_SHEETS, compileStoryCss, compileStoryCssWithExtras, currentStoryCss, storyCssCompileVersion, storySystemSheetCss,
} from '../server';

const STORY = '<p className="mt-7 text-sky-700">x</p>';

describe('compileStoryCss', () => {
  it('compiles the story\'s classes with the theme blocks last, and nothing for no story', async () => {
    expect(await compileStoryCss('')).toBeNull();
    expect(await compileStoryCss(null)).toBeNull();
    const css = (await compileStoryCss(STORY))!;
    expect(css).toContain('.mt-7');
    expect(css).toContain('.text-sky-700');
    expect(css).not.toContain('@layer');
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css.lastIndexOf('[data-theme="modernist"]')).toBeGreaterThan(css.indexOf('.mt-7'));
  });

  it('adds well-formed runtime classes in the same compile and drops malformed ones', async () => {
    expect(await compileStoryCssWithExtras(STORY, [])).toBe(await compileStoryCss(STORY));
    expect(await compileStoryCssWithExtras(STORY, ['bad;token'])).toBe(await compileStoryCss(STORY));
    const css = (await compileStoryCssWithExtras(STORY, ['w-[37%]', 'bad;token']))!;
    expect(css).toContain('.w-\\[37\\%\\]');
    expect(css).toContain('.mt-7');
  });
});

describe('currentStoryCss and storyCssCompileVersion', () => {
  it('versions the compile environment stably', () => {
    expect(storyCssCompileVersion()).toMatch(/^v[0-9a-z]+$/);
    expect(storyCssCompileVersion()).toBe(storyCssCompileVersion());
  });

  it('serves a current stored sheet as is, recompiles a stale one, and keeps a stale one without source', async () => {
    const version = storyCssCompileVersion();
    expect(await currentStoryCss({ compiledCss: 'stored', cssCompileVersion: version }, STORY)).toBe('stored');
    expect(await currentStoryCss({ compiledCss: 'stale', cssCompileVersion: 'v0' }, null)).toBe('stale');
    expect(await currentStoryCss({}, null)).toBeNull();
    expect(await currentStoryCss({ compiledCss: 'stale', cssCompileVersion: 'v0' }, STORY)).toBe(await compileStoryCss(STORY));
  });
});

describe('design system sheets', () => {
  it('hold every system\'s packaged faces and classes', () => {
    expect(Object.keys(STORY_SYSTEM_SHEETS).sort()).toEqual([...STORY_SYSTEM_NAMES].sort());
    for (const name of STORY_SYSTEM_NAMES) {
      expect(STORY_SYSTEM_SHEETS[name].fontFaces, name).toMatch(/^@font-face \{ font-family: /);
      expect(STORY_SYSTEM_SHEETS[name].fontFaces, name).toContain('src: url("/fonts/');
      expect(STORY_SYSTEM_SHEETS[name].css, name).toContain(`[data-theme="${name}"]`);
    }
  });

  it('add a system\'s faces then classes, and nothing for a theme, an unknown name or no design', () => {
    expect(storySystemSheetCss('volta')).toBe(`${STORY_SYSTEM_SHEETS.volta.fontFaces}\n${STORY_SYSTEM_SHEETS.volta.css}`);
    for (const name of ['modernist', 'nope', '', null, undefined]) expect(storySystemSheetCss(name)).toBe('');
  });
});
