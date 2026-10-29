/** lib/story-surface through its index: the root's names and the bare floors it serves. */
import { describe, expect, it } from 'vitest';
import {
  STORY_BARE_CONTROLS_CSS, STORY_BARE_TEXT_CSS, STORY_BARE_TYPOGRAPHY_CSS, STORY_ROOT_ATTR, STORY_STYLED_ATTR, STORY_TASK_CHECKBOX_CSS,
} from '..';

const rules = (css: string): string[] => css.replace(/@media[^{]*\{/g, '').split('}').map((r) => r.trim()).filter((r) => r.includes('{'));

describe('the story root', () => {
  it('is named by data attributes the served page and the exporter share', () => {
    expect(STORY_ROOT_ATTR).toBe('data-mx-story-root');
    expect(STORY_STYLED_ATTR).toBe('data-mx-styled');
  });
});

describe('the bare floors', () => {
  it('scope every rule to the story root and to elements the author left unstyled', () => {
    for (const css of [STORY_BARE_CONTROLS_CSS, STORY_BARE_TEXT_CSS]) {
      for (const rule of rules(css)) {
        expect(rule).toContain(`:where([${STORY_ROOT_ATTR}])`);
        expect(rule).toContain(':not([class])');
      }
    }
  });

  it('frame text fields only: never a checkbox, range or button input', () => {
    expect(STORY_BARE_CONTROLS_CSS).toContain('input:where(:not([class]):not([type=range]):not([type=checkbox])');
    expect(STORY_BARE_CONTROLS_CSS).toContain(':not([type=submit])');
    expect(STORY_BARE_CONTROLS_CSS).toContain('height:2.25rem');
  });

  it('give the whole document a gutter only when nothing in it is styled; the inline text floor has none', () => {
    expect(STORY_BARE_TYPOGRAPHY_CSS.startsWith(STORY_BARE_TEXT_CSS.slice(0, 200))).toBe(true);
    expect(STORY_BARE_TYPOGRAPHY_CSS).toContain(`:not([${STORY_STYLED_ATTR}])`);
    expect(STORY_BARE_TYPOGRAPHY_CSS).toContain('padding-inline:clamp(1rem,5vw,3rem)');
    expect(STORY_BARE_TEXT_CSS).not.toContain('padding-inline:clamp');
    expect(STORY_BARE_TEXT_CSS).not.toContain(STORY_STYLED_ATTR);
    expect(STORY_BARE_TYPOGRAPHY_CSS.length).toBeGreaterThan(STORY_BARE_TEXT_CSS.length);
  });

  it('step display sizes down on a phone in both floors', () => {
    for (const css of [STORY_BARE_TEXT_CSS, STORY_BARE_TYPOGRAPHY_CSS]) expect(css).toMatch(/@media \(max-width:639px\)\{[^@]*font-size:2rem/);
  });
});

describe('STORY_TASK_CHECKBOX_CSS', () => {
  it('styles only the saved task checkbox inside a story, without the browser\'s disabled skin', () => {
    for (const rule of rules(STORY_TASK_CHECKBOX_CSS)) expect(rule).toContain('input:where([type="checkbox"][aria-label="Task completed"])');
    expect(STORY_TASK_CHECKBOX_CSS).toContain('appearance:none');
    expect(STORY_TASK_CHECKBOX_CSS).toContain(`:where([${STORY_ROOT_ATTR}])`);
  });
});
