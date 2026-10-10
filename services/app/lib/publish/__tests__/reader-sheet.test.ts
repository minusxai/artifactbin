/**
 * THE READER'S SHEET (lib/publish/prepared/reader-sheet.server): a version's compiled
 * sheet minus the union recipes its story can never render and the other
 * themes' blocks — every kept rule byte-identical and in the full sheet's order.
 */
import { describe, expect, it } from 'vitest';
import * as cssTree from '@/lib/mermaid-images/css-parser';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { storyThemeCss } from '@/lib/data/story/story-themes';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { readerRecipes, readerStorySheet } from '../prepared/reader-sheet.server';
import { recipeReach } from '../../../scripts/generate-story-ui-classes';
import { STORY_UI_RECIPE_BASE, STORY_UI_RECIPE_BY_TAG, STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';

const PROSE = '<div className="p-4 text-lg"><h1>Notes</h1><p className="text-muted-foreground">Body</p></div>';
const ACCORDION = '<div className="p-4"><Accordion type="single" collapsible><AccordionItem value="a"><AccordionTrigger>Open</AccordionTrigger><AccordionContent>inside</AccordionContent></AccordionItem></Accordion></div>';
const rules = (css: string): string[] => {
  const out: string[] = [];
  cssTree.walk(cssTree.parse(css), { visit: 'Rule', enter(node: cssTree.Rule) { out.push(cssTree.generate(node)); } });
  return out;
};
const classesOf = (css: string): Set<string> => {
  const out = new Set<string>();
  cssTree.walk(cssTree.parse(css), { visit: 'ClassSelector', enter(node: cssTree.ClassSelector) { out.add(cssTree.ident.decode(node.name)); } });
  return out;
};
const sheetFor = async (source: string, theme: string | null) => {
  const full = (await compileStoryCss(source, { force: true }))!;
  return { full, reader: readerStorySheet(full, { source, nodes: parseJsxOrThrow(source).nodes, theme })! };
};

describe('the reader sheet', () => {
  it('keeps the runtime dark-mode palette even when prose has no authored dark class', async () => {
    const { reader } = await sheetFor(PROSE, null);
    expect(rules(reader).find(rule => rule.startsWith('.dark{') && rule.includes('--background:'))).toBeDefined();
  });

  it('drops the recipes of components a story does not use and keeps the ones it does', async () => {
    const prose = await sheetFor(PROSE, null);
    const accordion = await sheetFor(ACCORDION, null);
    expect(prose.reader.length).toBeLessThan(prose.full.length * 0.8);
    // The Accordion's own utilities (those the full sheet has rules for): gone from prose, kept wherever an Accordion renders.
    const own = STORY_UI_RECIPE_BY_TAG.Accordion!.map((i) => STORY_UI_RECIPE_CLASSES[i]!).filter((token) => classesOf(prose.full).has(token));
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((token) => classesOf(prose.reader).has(token))).toEqual([]);
    expect(own.filter((token) => !classesOf(accordion.reader).has(token))).toEqual([]);
    // The story's own classes and the runtime's chrome always stay.
    expect(prose.reader).toMatch(/\.text-lg\b/);
    expect(prose.reader).toMatch(/\.text-muted-foreground\b/);
  });

  it('keeps every surviving rule byte for byte, in the full sheet\'s order', async () => {
    const { full, reader } = await sheetFor(ACCORDION, 'modernist');
    const all = rules(full);
    let at = 0;
    for (const rule of rules(reader)) {
      const found = all.indexOf(rule, at);
      expect(found, rule.slice(0, 120)).toBeGreaterThanOrEqual(0);
      at = found + 1;
    }
    // The Tailwind variable block is whole: author CSS may read any variable the full sheet declared.
    const rootVars = (css: string) => rules(css).find((r) => r.startsWith(':root,:host'));
    expect(rootVars(reader)).toBe(rootVars(full));
  });

  it('keeps only the story\'s own theme blocks, in both modes', async () => {
    const themed = (await sheetFor(PROSE, 'modernist')).reader;
    expect(themed).toContain(':root:where([data-theme="modernist"])');
    expect(themed).toContain(':root:where([data-theme="modernist"].dark)');
    expect(themed).not.toContain(':root:where([data-theme="pop"])');
    expect(themed.endsWith(storyThemeCss('modernist'))).toBe(true);
    const plain = (await sheetFor(PROSE, null)).reader;
    expect(plain).not.toContain(':root:where([data-theme="modernist"])');
  });

  it('serves a legacy (non-jsx) sheet whole', async () => {
    // A sheet frozen before the theme blocks were appended: it has no theme tail to trim.
    const legacy = '.p-4{padding:1rem}';
    expect(legacy.endsWith(storyThemeCss())).toBe(false);
    expect(readerStorySheet(legacy, { source: '<div class="p-4">x</div>', nodes: [], theme: null })).toBe(legacy);
    expect(readerStorySheet(null, { source: '', nodes: [], theme: null })).toBeNull();
  });

  it('knows each tag\'s recipes from a fresh reading of the kit, and a conditional\'s tags too', () => {
    const fresh = recipeReach();
    expect(STORY_UI_RECIPE_BASE.map((i) => STORY_UI_RECIPE_CLASSES[i])).toEqual(fresh.base);
    expect(Object.fromEntries(Object.entries(STORY_UI_RECIPE_BY_TAG).map(([tag, list]) => [tag, list.map((i) => STORY_UI_RECIPE_CLASSES[i])]))).toEqual(fresh.byTag);
    const hidden = readerRecipes(parseJsxOrThrow('<div>{$_me.id ? <Accordion type="single"><AccordionItem value="a" /></Accordion> : <p>guest</p>}</div>').nodes);
    for (const i of STORY_UI_RECIPE_BY_TAG.Accordion!) expect(hidden.has(STORY_UI_RECIPE_CLASSES[i]!)).toBe(true);
  });
});
