/** lib/story-ui through its index: the document's third-party sources and the kit's class vocabulary. */
import { describe, expect, it } from 'vitest';
import { FONT_FILES, FONT_STYLES, FRAME_HOSTS, MODULE_CDNS, STORY_UI_RECIPE_CLASSES } from '..';

const isHttpsOrigin = (value: string): boolean => new URL(value).protocol === 'https:' && new URL(value).origin === value;

describe('document sources', () => {
  it('are bare https origins, each named once', () => {
    for (const list of [FRAME_HOSTS, MODULE_CDNS, [FONT_FILES, FONT_STYLES]]) {
      for (const origin of list) expect(isHttpsOrigin(origin), origin).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
    expect(FONT_STYLES).toBe('https://fonts.googleapis.com');
    expect(FONT_FILES).toBe('https://fonts.gstatic.com');
    expect(MODULE_CDNS).toEqual(['https://esm.sh', 'https://cdn.jsdelivr.net', 'https://unpkg.com']);
  });

  it('frame the default players and never the document\'s own CDNs', () => {
    expect(FRAME_HOSTS).toContain('https://www.youtube-nocookie.com');
    expect(FRAME_HOSTS).toContain('https://player.vimeo.com');
    for (const cdn of MODULE_CDNS) expect(FRAME_HOSTS).not.toContain(cdn);
  });
});

describe('STORY_UI_RECIPE_CLASSES', () => {
  it('is a deduplicated list of plausible class tokens', () => {
    expect(STORY_UI_RECIPE_CLASSES.length).toBeGreaterThan(500);
    expect(new Set(STORY_UI_RECIPE_CLASSES).size).toBe(STORY_UI_RECIPE_CLASSES.length);
    for (const token of STORY_UI_RECIPE_CLASSES) {
      expect(token, token).toMatch(/[a-zA-Z]/);
      expect(token, token).not.toMatch(/[\s{}$'"`<>]/);
    }
    expect(STORY_UI_RECIPE_CLASSES).toContain('flex');
  });
});
