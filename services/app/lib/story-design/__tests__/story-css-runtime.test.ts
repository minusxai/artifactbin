/**
 * RUNTIME CLASSES — a class that only exists once data arrives (`className="{$_row.cls}"` with the row's `cls`
 * from SQL) is compiled into the document's WHOLE sheet, never appended as a small one: Tailwind orders base
 * utilities before variants, and CSS ties resolve by source order.
 */
import { extractClassCandidates, hasRuntimeClasses, isRuntimeClassToken, offlineRuntimeClasses, RUNTIME_CLASS_LIMIT, runtimeClassExtras } from '../story-css';
import { compileStoryCss, compileStoryCssWithExtras, STORY_RECIPE_UNION, storyCssCompileVersion, unionStoryCss } from '../story-css.server';
import { splitStoryCss, storyCssBase } from '@/lib/page-styles';
import { storyThemeCss } from '../story-themes';


const ROW_TEMPLATE = '<For each={$rows} keyBy="id"><span className="px-2 {$_row.cls}">x</span></For>';

/** Where `selector` (escaped as Tailwind writes it) first opens a rule, or -1. */
const ruleAt = (css: string, selector: string): number => css.indexOf(`${selector} {`) >= 0 ? css.indexOf(`${selector} {`) : css.indexOf(`${selector}{`);

describe('runtime class tokens', () => {
  it('accepts utilities, variants and arbitrary values; refuses what is not a class', () => {
    for (const token of ['bg-lime-500', 'hover:bg-sky-600', 'md:w-64', 'w-[37%]', 'dark:text-white', '[&>p]:mt-3', 'w-1/2', '!p-2']) {
      expect(isRuntimeClassToken(token), token).toBe(true);
    }
    for (const token of ['', 'a b', '{$_row.cls}', 'x"y', 'x<y', 'w-[1px];color:red', 'a\\b', 'é-1', 'x'.repeat(121)]) {
      expect(isRuntimeClassToken(token), token).toBe(false);
    }
  });

  it('keeps only the unknown, well-formed tokens, sorted, deduped and capped', () => {
    const known = new Set(['px-2', 'bg-red-500']);
    expect(runtimeClassExtras(['w-[37%]', 'px-2', 'bg-lime-500', 'bg-lime-500', 'a"b', 'bg-red-500'], known)).toEqual(['bg-lime-500', 'w-[37%]']);
    const many = Array.from({ length: RUNTIME_CLASS_LIMIT + 40 }, (_, i) => `w-${i}`);
    expect(runtimeClassExtras(many, new Set())).toHaveLength(RUNTIME_CLASS_LIMIT);
  });

  it('a document fills a class at runtime only when a class attribute carries a template or an expression', () => {
    expect(hasRuntimeClasses(ROW_TEMPLATE)).toBe(true);
    expect(hasRuntimeClasses('<div className={$tone}>x</div>')).toBe(true);
    expect(hasRuntimeClasses("<div class='{$_row.cls}'>x</div>")).toBe(true);
    // The common case: every class literal (and braces elsewhere are not classes).
    expect(hasRuntimeClasses('<div className="md:w-1/2 bg-card" title="{x}"><Value name="x" />{$x}</div>')).toBe(false);
  });

  it('the offline file takes the class-shaped words of its exported rows, utility-shaped first', () => {
    const extras = offlineRuntimeClasses('<div className="px-2">x</div>', [
      [{ cls: 'bg-lime-500 hover:bg-sky-600', note: 'Paid in full', n: 3 }, { cls: 'w-[37%]', note: null }],
    ]);
    expect(extras.slice(0, 3)).toEqual(['bg-lime-500', 'hover:bg-sky-600', 'w-[37%]']);
    expect(extras).not.toContain('px-2');
    expect(extras).toContain('Paid');
  });
});

describe('compileStoryCssWithExtras', () => {
  it('with no extras is the stored compile, byte for byte', async () => {
    expect(await compileStoryCssWithExtras(ROW_TEMPLATE, [])).toBe(await compileStoryCss(ROW_TEMPLATE));
  });

  it('compiles the runtime classes a row brings: colours, variants and arbitrary values', async () => {
    const css = (await compileStoryCssWithExtras(ROW_TEMPLATE, ['bg-lime-500', 'hover:bg-sky-600', 'md:w-64', 'w-[37%]', 'bg-not-a-color-500']))!;
    expect(css).toContain('.bg-lime-500');
    expect(css).toContain('.hover\\:bg-sky-600');
    expect(css).toContain('.md\\:w-64');
    expect(css).toContain('.w-\\[37\\%\\]');
    // Tailwind drops what is not a utility; the sheet still compiles.
    expect(css).not.toContain('bg-not-a-color-500');
    expect(css.endsWith(storyThemeCss())).toBe(true);
  });

  it('is the WHOLE ordered sheet: a runtime `w-full` stands before a static `md:w-1/2`, so the breakpoint wins', async () => {
    const source = '<For each={$rows} keyBy="id"><div className="md:w-1/2 {$_row.cls}">x</div></For>';
    const css = (await compileStoryCssWithExtras(source, ['w-full']))!;
    const base = ruleAt(css, '.w-full');
    const md = css.indexOf('.md\\:w-1\\/2');
    expect(base).toBeGreaterThan(-1);
    expect(md).toBeGreaterThan(base);
    // Exactly the sheet the same document would have compiled had it named `w-full` itself.
    expect(css).toBe(await compileStoryCss(`${source}<i className="w-full" />`));
  });

  it("the document's sheet with extras still splits over the shared shards (the linked copy keeps working)", async () => {
    const css = (await compileStoryCssWithExtras(ROW_TEMPLATE, ['bg-lime-500', 'w-[37%]']))!;
    const base = storyCssBase(await unionStoryCss(), storyThemeCss())!;
    expect(splitStoryCss(css, base)).not.toBeNull();
  });

  it('never trusts its extras: malformed and over-limit tokens are dropped, not compiled', async () => {
    const css = (await compileStoryCssWithExtras(ROW_TEMPLATE, ['w-[1px];color:red', 'bg-lime-500']))!;
    expect(css).toContain('.bg-lime-500');
    expect(css).not.toContain('color:red');
  });

  it('a union class needs no extra: the recipe union is always compiled', () => {
    expect(STORY_RECIPE_UNION.length).toBeGreaterThan(0);
    expect(extractClassCandidates(ROW_TEMPLATE)).toContain('px-2');
    expect(storyCssCompileVersion()).toMatch(/^v/);
  });
});
