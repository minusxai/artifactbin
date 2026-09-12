/**
 * The story `<Grid>`/`<GridItem>` positioning classes MUST survive the per-story Tailwind
 * compile. They live as literal class strings in components/kit/grid.tsx, reach every
 * story's stylesheet through the recipe-class union (STORY_UI_RECIPE_CLASSES), and are the
 * ONLY thing positioning grid items in view mode and in captures — if the compiler ever
 * stops emitting one of these calc()/container-query utilities, grids silently collapse to
 * a stack of unpositioned divs. This pins actual CSS emission, not candidate extraction.
 */
import { compileStoryCss, STORY_RECIPE_UNION } from '../story-css.server';
import { STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';

const GRID_STORY =
  '<div class="mx-story" data-design="tw">' +
  '<Grid><GridItem x={0} y={0} w={8} h={5}><p>alpha</p></GridItem></Grid>' +
  '</div>';

/** The load-bearing grid classes, exactly as written in components/kit/grid.tsx. */
const GRID_CLASSES = [
  'h-[calc(var(--g-rows)*var(--g-rh))]',
  'left-[calc(var(--gi-x)/var(--g-cols)*100%)]',
  'top-[calc(var(--gi-y)*var(--g-rh))]',
  'w-[calc(var(--gi-w)/var(--g-cols)*100%)]',
  'h-[calc(var(--gi-h)*var(--g-rh))]',
  '@max-2xl:static',
  '@max-2xl:w-full',
  '@max-2xl:h-auto',
  'p-[3px]',
];

describe('story grid CSS compilation', () => {
  it('every grid positioning class is in the recipe union (extractor coverage)', () => {
    for (const cls of GRID_CLASSES) {
      expect(STORY_UI_RECIPE_CLASSES).toContain(cls);
    }
  });

  it('the story compile EMITS a rule for every grid positioning class', async () => {
    const css = await compileStoryCss(GRID_STORY);
    expect(css).toBeTruthy();
    // Distinctive value fragments that only appear if the utility actually compiled
    // (Tailwind pretty-prints calc() with spaces around operators).
    expect(css).toContain('left: calc(var(--gi-x) / var(--g-cols) * 100%)');
    expect(css).toContain('top: calc(var(--gi-y) * var(--g-rh))');
    expect(css).toContain('width: calc(var(--gi-w) / var(--g-cols) * 100%)');
    expect(css).toContain('height: calc(var(--gi-h) * var(--g-rh))');
    expect(css).toContain('height: calc(var(--g-rows) * var(--g-rh))');
    // The stacking fallback compiles as a max-width container query. Which side
    // wraps which is Tailwind's business and has changed between minors (4.2
    // nested the query inside the class, 4.3 nests the class inside the query),
    // so what is asserted is that BOTH appear, adjacent — the rule exists.
    const query = (css ?? '').indexOf('@container (width < 42rem)');
    const utility = (css ?? '').indexOf('@max-2xl\\:static');
    expect(query, 'no max-width container query compiled').toBeGreaterThan(-1);
    expect(utility, 'no @max-2xl:static utility compiled').toBeGreaterThan(-1);
    expect(Math.abs(query - utility)).toBeLessThan(200);
    // The gutter padding.
    expect(css).toContain('padding: 3px');
  });
});

/*
 * Moved here from story-css-question-title.test.ts: the same union-membership →
 * emission pair for the other set of classes that reaches the sheet only through
 * a recipe union. The `<Question>` title strip is chart chrome in the mono face,
 * and its classes never appear in story markup, so a candidate the compiler drops
 * fails silently as "the title just looks sans".
 */
describe('the Question title chrome CSS', () => {
  const TITLE_STORY = '<div className="p-4"><Question title="t" data="ref:dsOne01" /></div>';

  it('font-mono is in the recipe union (extractor coverage)', () => {
    expect(STORY_RECIPE_UNION).toContain('font-mono');
  });

  it('the story compile EMITS the font-mono rule', async () => {
    const css = await compileStoryCss(TITLE_STORY, { force: true });
    expect(css).toBeTruthy();
    expect(css).toMatch(/\.font-mono\s*\{/);
  });
});
