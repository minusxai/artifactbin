/**
 * Regenerate lib/story-ui/recipe-classes.ts — the Tailwind candidate tokens used by the
 * vendored shadcn component sources. The per-story compile extracts
 * candidates from STORY markup only; component chrome classes (rounded-xl, shadow-sm, …)
 * live in the component sources, so they are pre-extracted here and unioned at compile
 * time for markup documents.
 *
 * Run after changing anything under components/kit/:
 *   npm run generate-story-ui-classes
 * A freshness test (lib/story-ui/__tests__/recipe-classes.test.ts) fails when this file
 * is stale. Extraction is a deliberate superset: every whitespace-separated token of every
 * string literal in the sources. Non-class tokens are harmless — Tailwind emits nothing
 * for candidates it doesn't recognize.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS_DIR = join(ROOT, 'components', 'kit');

/**
 * Sources OUTSIDE components/kit whose class literals still reach a story —
 * embed chrome renders INSIDE the iframe, whose only stylesheet is the compiled
 * story CSS. A component that leaves that directory has to be named here or its
 * classes silently stop compiling into the base sheet — the authored element
 * renders unstyled, with nothing anywhere to say why. Every entry must exist on
 * disk (lib/story-ui/__tests__/embed-chrome-coverage.test.ts enforces it, so a
 * renamed file cannot silently fall out of the sheet).
 */
export const EXTRA_CLASS_SOURCES = [
  join(ROOT, 'components', 'viz', 'VegaChart.tsx'),
  join(ROOT, 'components', 'views', 'story', 'InlineNumber.tsx'),
  join(ROOT, 'components', 'views', 'story', 'QuestionEmbed.tsx'),
  // The in-frame runtime composition renders embed chrome of its own (the
  // DataTable adapter's loading/error box) — its utilities must compile too.
  join(ROOT, 'lib', 'story-runtime', 'StoryRuntimeApp.tsx'),
  // App chrome AND a registered story component, so it lives beside the app's
  // primitives (the reader graph may not reach components/kit) — but a story
  // still renders it, so its classes belong in the sheet.
  join(ROOT, 'components', 'Tooltip.tsx'),
  join(ROOT, 'components', 'PersonMention.tsx'),
  // The <DeckGL> map's chrome classes, shared by today's engine (components/kit/deck-gl-engine) and the
  // compiled page's (lib/islands/kit/embed/deck-engine).
  join(ROOT, 'lib', 'viz', 'deck-chrome.ts'),
];
const OUT_FILE = join(ROOT, 'lib', 'story-ui', 'recipe-classes.ts');

/** The plausible utility tokens of one source file's string literals. */
export function extractFileClasses(file: string): string[] {
  const tokens = new Set<string>();
  const raw = readFileSync(file, 'utf8');
  // Comments carry no class candidates, and an apostrophe inside one ("the
  // realm's document") desyncs the naive quote pairing below — a phantom
  // literal opens at the apostrophe and swallows every real class string
  // until the next one. Strip them first; line comments only when the `//`
  // is not a URL's (`http://…` inside a string must survive).
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<!:)\/\/[^\n]*/g, ' ');
  // Every string literal (' " `) — cva recipes, className constants, template chunks.
  for (const m of src.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const lit = m[1] ?? m[2] ?? m[3] ?? '';
    for (const tok of lit.split(/\s+/)) {
      // Plausible utility tokens only: no quotes/braces/template holes, at least one letter.
      if (tok && !/[{}$'"`<>]/.test(tok) && /[a-zA-Z]/.test(tok)) tokens.add(tok);
    }
  }
  return [...tokens].sort();
}

/** Every class source: the kit's components, then the files named beside it. */
export function recipeSourceFiles(dir: string, extraFiles: string[] = []): string[] {
  return [
    ...readdirSync(dir).filter((f) => f.endsWith('.tsx')).sort().map((f) => join(dir, f)),
    ...extraFiles.filter((f) => existsSync(f)),
  ];
}

export function extractRecipeClasses(dir: string, extraFiles: string[] = []): string[] {
  const tokens = new Set<string>();
  for (const file of recipeSourceFiles(dir, extraFiles)) for (const tok of extractFileClasses(file)) tokens.add(tok);
  return [...tokens].sort();
}

const REGISTRY_FILE = join(ROOT, 'lib', 'story-ui', 'registry.ts');

/** A module specifier as a class-source path, when it names one. */
function resolveSource(spec: string, from: string, sources: ReadonlySet<string>): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`]) if (sources.has(candidate)) return candidate;
  return null;
}

/** The class sources `file` renders with: itself and every class source it imports, statically or on demand. */
function sourceClosure(file: string, sources: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>([file]);
  const queue = [file];
  while (queue.length) {
    const next = queue.shift()!;
    const src = readFileSync(next, 'utf8');
    for (const m of src.matchAll(/(?:\bfrom|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
      const hit = resolveSource(m[1]!, next, sources);
      if (hit && !seen.has(hit)) { seen.add(hit); queue.push(hit); }
    }
  }
  return seen;
}

/**
 * WHICH RECIPES A DOCUMENT CAN RENDER. The reader's sheet (lib/story/reader-sheet.server)
 * keeps only the utilities of the components a document uses, so each registry tag is
 * mapped to the class sources it renders with (its file and every class source that file
 * imports). `base` is what every document can render whatever it names: the runtime's own
 * chrome and adapters (every source named beside the kit, and all they import).
 */
export function recipeReach(dir: string, extraFiles: string[] = EXTRA_CLASS_SOURCES, registryFile: string = REGISTRY_FILE): { base: string[]; byTag: Record<string, string[]> } {
  const files = recipeSourceFiles(dir, extraFiles);
  const sources = new Set(files);
  const tokensOf = (set: Iterable<string>) => { const out = new Set<string>(); for (const f of set) for (const t of extractFileClasses(f)) out.add(t); return out; };
  const baseFiles = new Set<string>();
  for (const extra of extraFiles.filter((f) => sources.has(f))) for (const f of sourceClosure(extra, sources)) baseFiles.add(f);
  const base = tokensOf(baseFiles);
  const byTag: Record<string, string[]> = {};
  const registry = readFileSync(registryFile, 'utf8');
  for (const m of registry.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const file = resolveSource(m[2]!, registryFile, sources);
    if (!file) continue;
    const extra = [...tokensOf(sourceClosure(file, sources))].filter((t) => !base.has(t)).sort();
    for (const spec of m[1]!.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (spec.startsWith('type ')) continue;
      byTag[spec.split(/\s+as\s+/).at(-1)!] = extra;
    }
  }
  return { base: [...base].sort(), byTag: Object.fromEntries(Object.entries(byTag).sort(([a], [b]) => a.localeCompare(b))) };
}

function main() {
  const classes = extractRecipeClasses(COMPONENTS_DIR, EXTRA_CLASS_SOURCES);
  const body = classes.map((c) => `  ${JSON.stringify(c)},`).join('\n');
  const index = new Map(classes.map((c, i) => [c, i]));
  const reach = recipeReach(COMPONENTS_DIR);
  const indices = (tokens: string[]) => `[${tokens.map((t) => index.get(t)!).join(', ')}]`;
  const byTag = Object.entries(reach.byTag).map(([tag, tokens]) => `  ${JSON.stringify(tag)}: ${indices(tokens)},`).join('\n');
  writeFileSync(
    OUT_FILE,
    `/**
 * GENERATED by scripts/generate-story-ui-classes.ts — do not edit by hand.
 * Tailwind candidate tokens extracted from components/kit sources; unioned with
 * per-story candidates when compiling markup document CSS (see story-css.server.ts).
 * Regenerate with: npm run generate-story-ui-classes
 */
export const STORY_UI_RECIPE_CLASSES: readonly string[] = [
${body}
];

/** Indices (into STORY_UI_RECIPE_CLASSES) of the recipes EVERY document can render: the runtime's chrome and adapters. */
export const STORY_UI_RECIPE_BASE: readonly number[] = ${indices(reach.base)};

/** Per registry tag, the further recipes that tag's component renders with (its file and the class sources it imports). */
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
