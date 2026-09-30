/**
 * Regenerate lib/story-ui/recipe-classes.ts — the Tailwind candidate tokens the story kit renders
 * with (lib/islands/kit: its components and their compile-time class recipes). The per-story compile
 * extracts candidates from STORY markup only; component chrome classes (rounded-xl, shadow-sm, …) live
 * in the kit's sources, so they are pre-extracted here and unioned at compile time for markup
 * documents.
 *
 * Run after changing anything under lib/islands/kit/:
 *   npm run generate-story-ui-classes
 * A freshness test (lib/story-ui/__tests__/recipe-classes.test.ts) fails when this file is stale.
 * Extraction is a deliberate superset: every whitespace-separated token of every string literal in
 * the sources. Non-class tokens are harmless — Tailwind emits nothing for candidates it doesn't
 * recognize.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { FAMILIES } from '../lib/islands/kit/recipes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The story kit: the compiled page's components and their class recipes. */
export const KIT_DIR = join(ROOT, 'lib', 'islands', 'kit');

/**
 * Sources OUTSIDE the kit whose class literals still reach a story. A component that leaves the kit
 * directory has to be named here or its classes silently stop compiling into the base sheet — the
 * authored element renders unstyled, with nothing anywhere to say why. Every entry must exist on
 * disk (lib/story-ui/__tests__/embed-chrome-coverage.test.ts enforces it).
 */
export const EXTRA_CLASS_SOURCES = [
  // The compiler writes the static shells itself (Grid and GridItem geometry, native table cells,
  // the deck rail): their utilities are its string literals.
  join(ROOT, 'lib', 'compiled-page', 'compiler.ts'),
  join(ROOT, 'lib', 'compiled-page', 'rail-preview.server.ts'),
  join(ROOT, 'lib', 'islands', 'rt.tsx'),
  // A served chart drawing's box (the chart island and the server's prerender share it).
  join(ROOT, 'lib', 'islands', 'chart.ts'),
  // The icon kit's framework-free class contract.
  join(ROOT, 'lib', 'story-ui', 'icon-contract.ts'),
  // The <DeckGL> map's chrome classes (lib/islands/kit/embed/deck-engine).
  join(ROOT, 'lib', 'viz', 'deck-chrome.ts'),
];
const OUT_FILE = join(ROOT, 'lib', 'story-ui', 'recipe-classes.ts');
/** The compiler's KIT table names each component tag's family (`mod`). */
const COMPILER_FILE = join(ROOT, 'lib', 'compiled-page', 'compiler.ts');

/** The plausible utility tokens of one source file's string literals (parsed, so code never reads as a literal). */
export function extractFileClasses(file: string): string[] {
  const tokens = new Set<string>();
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (text: string) => {
    for (const tok of text.split(/\s+/)) {
      // Plausible utility tokens only: no quotes/braces/template holes, at least one letter.
      if (tok && !/[{}$'"`<>]/.test(tok) && /[a-zA-Z]/.test(tok)) tokens.add(tok);
    }
  };
  const visit = (node: ts.Node): void => {
    // Every string literal (' " `, template chunks) — recipes, class constants, JSX attribute strings.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node.text);
    else if (ts.isJsxText(node)) { /* rendered text, never a class */ }
    ts.forEachChild(node, visit);
    if (ts.isTemplateExpression(node)) { add(node.head.text); for (const span of node.templateSpans) add(span.literal.text); }
  };
  visit(source);
  return [...tokens].sort();
}

/** Every source file under `dir`, depth first, sorted. */
function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) return name === '__tests__' ? [] : walk(file);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

/** Every class source: the kit's files, then the files named beside it. */
export function recipeSourceFiles(dir: string, extraFiles: string[] = []): string[] {
  return [...walk(dir), ...extraFiles.filter((f) => existsSync(f))];
}

export function extractRecipeClasses(dir: string, extraFiles: string[] = []): string[] {
  const tokens = new Set<string>();
  for (const file of recipeSourceFiles(dir, extraFiles)) for (const tok of extractFileClasses(file)) tokens.add(tok);
  return [...tokens].sort();
}

/** The files a kit family owns: its recipe module, its component module and its component directory. */
function familyFiles(dir: string, family: string): string[] {
  const own = [join(dir, 'recipes', `${family}.ts`), join(dir, `${family}.tsx`), join(dir, `${family}.ts`)].filter((f) => existsSync(f));
  const sub = join(dir, family);
  return existsSync(sub) && statSync(sub).isDirectory() ? [...own, ...walk(sub)] : own;
}

/**
 * WHICH RECIPES A DOCUMENT CAN RENDER. The reader's sheet (lib/story/reader-sheet.server) keeps only
 * the utilities of the components a document uses, so each kit tag is mapped to the class sources of
 * its family (the compiler's `KIT` table, and lib/islands/kit/recipes `FAMILIES`). `base` is what every document can render whatever
 * it names: the kit's shared modules (every source no family owns) and the sources named beside it.
 */
export function recipeReach(dir: string = KIT_DIR, extraFiles: string[] = EXTRA_CLASS_SOURCES): { base: string[]; byTag: Record<string, string[]> } {
  const tokensOf = (set: Iterable<string>) => { const out = new Set<string>(); for (const f of set) for (const t of extractFileClasses(f)) out.add(t); return out; };
  const owned = new Map<string, string[]>();
  for (const family of Object.keys(FAMILIES)) owned.set(family, familyFiles(dir, family));
  const claimed = new Set([...owned.values()].flat());
  const base = tokensOf([...walk(dir).filter((f) => !claimed.has(f)), ...extraFiles.filter((f) => existsSync(f))]);
  // Each tag's family: the compiler's KIT table (tag → `mod`), and every tag a family's recipes name.
  const familyOf = new Map<string, string>();
  for (const [family, recipes] of Object.entries(FAMILIES)) for (const tag of Object.keys(recipes)) familyOf.set(tag, family);
  for (const m of readFileSync(COMPILER_FILE, 'utf8').matchAll(/\b([A-Z]\w*): \{ mod: '(\w+)'/g)) if (owned.has(m[2]!)) familyOf.set(m[1]!, m[2]!);
  const byTag: Record<string, string[]> = {};
  const extraOf = new Map<string, string[]>();
  for (const [tag, family] of familyOf) {
    if (!extraOf.has(family)) extraOf.set(family, [...tokensOf(owned.get(family) ?? [])].filter((t) => !base.has(t)).sort());
    byTag[tag] = extraOf.get(family)!;
  }
  return { base: [...base].sort(), byTag: Object.fromEntries(Object.entries(byTag).sort(([a], [b]) => a.localeCompare(b))) };
}

function main() {
  const classes = extractRecipeClasses(KIT_DIR, EXTRA_CLASS_SOURCES);
  const body = classes.map((c) => `  ${JSON.stringify(c)},`).join('\n');
  const index = new Map(classes.map((c, i) => [c, i]));
  const reach = recipeReach(KIT_DIR);
  const indices = (tokens: string[]) => `[${tokens.map((t) => index.get(t)!).join(', ')}]`;
  const byTag = Object.entries(reach.byTag).map(([tag, tokens]) => `  ${JSON.stringify(tag)}: ${indices(tokens)},`).join('\n');
  writeFileSync(
    OUT_FILE,
    `/**
 * GENERATED by scripts/generate-story-ui-classes.ts — do not edit by hand.
 * Tailwind candidate tokens extracted from the story kit (lib/islands/kit); unioned with
 * per-story candidates when compiling markup document CSS (see story-css.server.ts).
 * Regenerate with: npm run generate-story-ui-classes
 */
export const STORY_UI_RECIPE_CLASSES: readonly string[] = [
${body}
];

/** Indices (into STORY_UI_RECIPE_CLASSES) of the recipes EVERY document can render: the kit's shared chrome. */
export const STORY_UI_RECIPE_BASE: readonly number[] = ${indices(reach.base)};

/** Per kit tag, the further recipes that tag's family renders with. */
export const STORY_UI_RECIPE_BY_TAG: Readonly<Record<string, readonly number[]>> = {
${byTag}
};
`,
  );
  console.log(`wrote ${classes.length} tokens to lib/story-ui/recipe-classes.ts`);
}

// Run only when executed directly (npm run generate-story-ui-classes) — the freshness test
// imports extractRecipeClasses and must not trigger a rewrite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
