/**
 * Explicit HTML layout utilities still compile after the Grid/GridItem renderer's
 * removal. Retained component chrome still enters through the generated union.
 * Check emitted CSS as well as candidate extraction so styling cannot vanish silently.
 */
import { compileStoryCss, STORY_RECIPE_UNION } from '../story-css.server';
import { STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';

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

// Geometry is authored HTML now; no deleted JSX renderer injects these classes.
const GRID_STORY = `<section class="mx-story @container" data-design="tw" style="--g-cols:12;--g-rh:86px;--g-rows:5">
  <div class="relative w-full ${GRID_CLASSES[0]} @max-2xl:h-auto">
    <div class="absolute ${GRID_CLASSES.slice(1).join(' ')}" style="--gi-x:0;--gi-y:0;--gi-w:8;--gi-h:5">alpha</div>
  </div>
</section>`;

describe('story grid CSS compilation', () => {
  it('retained card and data chrome stays in the recipe union and emitted stylesheet', async () => {
    const css = await compileStoryCss('<section><p>Content without chrome classes</p></section>');
    for (const cls of ['bg-card', 'border-border', 'tabular-nums']) {
      expect(STORY_UI_RECIPE_CLASSES).toContain(cls);
      expect(css).toContain(`.${cls} {`);
    }
  });

  it('explicit HTML grid classes emit their geometry, responsive fallback and gutter rules', async () => {
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

/** Chart title chrome reaches the sheet through the recipe union, not authored classes. */
describe('retained chart title chrome CSS', () => {
  const TITLE_STORY = '<section class="p-4"><h2>Chart title</h2></section>';

  it('font-mono is in the recipe union (extractor coverage)', () => {
    expect(STORY_RECIPE_UNION).toContain('font-mono');
  });

  it('the story compile EMITS the font-mono rule', async () => {
    const css = await compileStoryCss(TITLE_STORY, { force: true });
    expect(css).toBeTruthy();
    expect(css).toMatch(/\.font-mono\s*\{/);
  });
});
