/**
 * The `<Question>` title strip is chart chrome and renders in the chart's mono
 * face. Its classes never appear in story markup — they reach the compiled
 * sheet only through the recipe-class union — so this pins actual CSS emission,
 * not candidate extraction (a candidate the compiler drops fails silently as
 * "the title just looks sans").
 */
import { compileStoryCss } from '../story-css.server';
import { STORY_RECIPE_UNION } from '../story-css.server';

const STORY = '<div className="p-4"><Question title="t" data="ref:dsOne01" /></div>';

describe('the Question title chrome CSS', () => {
  it('font-mono is in the recipe union (extractor coverage)', () => {
    expect(STORY_RECIPE_UNION).toContain('font-mono');
  });

  it('the story compile EMITS the font-mono rule', async () => {
    const css = await compileStoryCss(STORY, { force: true });
    expect(css).toBeTruthy();
    expect(css).toMatch(/\.font-mono\s*\{/);
  });
});
