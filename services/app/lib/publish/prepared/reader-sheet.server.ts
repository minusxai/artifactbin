/**
 * THE READER'S SHEET — a version's compiled stylesheet with what its story
 * can never match taken out, for the prepared page (lib/publish/prepared/prepared-page.server).
 *
 * Every compiled document sheet carries the recipe union (every kit
 * component's utilities and the typography toolbar's palette) and every
 * theme's token blocks, so an editor can apply any class or theme without a
 * recompile. A READER of one version can only ever render:
 *
 *   - the classes its own markup names;
 *   - the recipes of the components it uses (lib/story-ui/recipe-classes,
 *     generated per registry tag with every class source that tag imports),
 *     plus the runtime's own chrome and adapters, which any document renders;
 *   - its own theme's blocks — a reader can switch light/dark, never the theme.
 *
 * A rule is removed only when EVERY class it selects is a union recipe no
 * element of this story can carry, and a theme block only when it names another
 * theme on the story root. Nothing else moves: the Tailwind variable block,
 * @property and @keyframes rules, and every kept rule's order are the full
 * sheet's, so every element's computed style is the full sheet's.
 *
 * Only the reader's copy is pruned. The stored `compiledCss` stays whole — the
 * editor, /raw, the export and the offline file all use it — and a live or
 * editor update re-isolates from those whole sheets (lib/story-runtime/inline-sheet).
 */
import * as cssTree from '@/lib/mermaid-images/css-parser';
import type { JsxNode } from '@/lib/jsx';
import { STORY_RECIPE_UNION } from '@/lib/data/story/story-css.server';
import { extractClassCandidates } from '@/lib/data/story/story-css';
import { storyThemeCss } from '@/lib/data/story/story-themes';
import { STORY_UI_RECIPE_BASE, STORY_UI_RECIPE_BY_TAG, STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';

/** Every element tag anywhere in the tree — conditionals, fragments and embedded templates included. */
function tagsOf(nodes: readonly JsxNode[]): Set<string> {
  const tags = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: unknown; tag?: unknown };
    if (node.type === 'element' && typeof node.tag === 'string') tags.add(node.tag);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(nodes);
  return tags;
}

/** The union recipes this story can render: the runtime's base and its tags' components. */
export function readerRecipes(nodes: readonly JsxNode[]): Set<string> {
  const kept = new Set<string>(STORY_UI_RECIPE_BASE.map((i) => STORY_UI_RECIPE_CLASSES[i]!));
  for (const tag of tagsOf(nodes)) for (const i of STORY_UI_RECIPE_BY_TAG[tag] ?? []) kept.add(STORY_UI_RECIPE_CLASSES[i]!);
  return kept;
}

const decoded = (name: string): string => cssTree.ident.decode(name);

/** `compiled` for a reader of this version; unchanged when it is not a current jsx sheet. */
export function readerStorySheet(compiled: string | null, story: { source: string; nodes: readonly JsxNode[]; theme: string | null }): string | null {
  const themes = storyThemeCss();
  // A legacy (non-jsx) sheet carries no theme blocks and is frozen as published: served whole.
  if (!compiled || !compiled.endsWith(themes)) return compiled;
  const kept = readerRecipes(story.nodes);
  for (const candidate of extractClassCandidates(story.source)) kept.add(candidate);
  // Mode belongs to the document runtime, independent of authored utilities.
  const dropped = new Set(STORY_RECIPE_UNION.filter((token) => token !== 'dark' && !kept.has(token)));
  let ast: cssTree.CssNode;
  try { ast = cssTree.parse(compiled.slice(0, compiled.length - themes.length)); } catch { return compiled; }
  cssTree.walk(ast, {
    visit: 'Rule',
    enter(node: cssTree.Rule, item: cssTree.ListItem<cssTree.CssNode>, list: cssTree.List<cssTree.CssNode>) {
      const classes: string[] = [];
      cssTree.walk(node.prelude, { visit: 'ClassSelector', enter(selector: cssTree.ClassSelector) { classes.push(decoded(selector.name)); } });
      if (item && classes.length > 0 && classes.every((name) => dropped.has(name))) list.remove(item);
    },
  });
  // A grouping rule left with nothing inside says nothing.
  let emptied = true;
  while (emptied) {
    emptied = false;
    cssTree.walk(ast, {
      visit: 'Atrule',
      enter(node: cssTree.Atrule, item: cssTree.ListItem<cssTree.CssNode>, list: cssTree.List<cssTree.CssNode>) {
        if (item && node.block && node.block.children.isEmpty && ['media', 'supports', 'container', 'layer'].includes(decoded(node.name).toLowerCase())) { list.remove(item); emptied = true; }
      },
    });
  }
  return `${cssTree.generate(ast)}\n${storyThemeCss(story.theme)}`;
}
