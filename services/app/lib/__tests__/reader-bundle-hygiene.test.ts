/**
 * The reader of /a/<slug> must not pay for the charting engine.
 *
 * The route's client entry is the Solid document page (solid/pages/Document); everything it
 * reaches through STATIC runtime imports lands in the page's app chunk.
 * The vega stack (vega + vega-lite + vega-interpreter + vega-tooltip) is
 * ~500 KB gzipped — two thirds of the whole route — and a plain-text story
 * must never download it. It may only enter through a dynamic import, the same
 * boundary that already keeps the source editor out.
 *
 * This walks the import graph the way the bundler does: follow value imports,
 * skip `import type` (erased at compile time) and dynamic `import()` (its own
 * chunk). If a static edge to a forbidden package appears anywhere under the
 * reader entries, this fails and prints the chain that admitted it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

/** The client page every reader of a document is handed (solid/App's document route). */
const READER_ENTRIES = [
  'solid/pages/Document.tsx',
];

/**
 * The page's SQLite engine (lib/story-runtime/page-sqlite): the core and the
 * official wasm package behind it. Only a reader who holds data runs anything
 * in the page, so it is a lazy chunk on BOTH reader paths — never first paint.
 */
const SQLITE = ['@artifactbin/sql', '@sqlite.org/sqlite-wasm'];

/**
 * Heavy packages that must stay behind a dynamic-import boundary.
 *
 * The CodeMirror packages are the source editor (solid/editor/SourceEditor,
 * through lib/source-editor/codemirror): only an owner who presses `code` pays.
 */
const FORBIDDEN = ['vega', 'vega-lite', 'vega-interpreter', 'vega-tooltip', '@codemirror/view', '@codemirror/state', '@codemirror/language', '@codemirror/lang-javascript', ...SQLITE];

/**
 * The compiled document's page, boot and Solid runtime entries. They are the
 * shared browser graph shipped to `/raw` readers under `/islands/`.
 */
const RUNTIME_ENTRY = ['lib/islands/page.ts', 'lib/islands/rt.tsx', 'lib/islands/boot.ts'];

/**
 * Packages the document runtime must never reach statically.
 *
 * `acorn`/`acorn-jsx` are the JSX PARSER: the island carries parsed NODES, not
 * source (see entry.tsx), so the runtime has nothing to parse — it arrived only
 * because the `<Question>` sizing contract sat in a module that also imports the
 * editor's AST write-back. 250 KB raw of parser for a number.
 *
 * An ICON SET (`lucide-solid`, `lucide-static`): `<Icon name>` resolves any of ~1600 glyphs by
 * name, and the whole map is 517 KB raw, 148 KB gz. The glyphs a document actually uses are
 * resolved server-side and travel in the island beside `refData` (lib/story/assets/icon-glyphs.ts).
 */
const RUNTIME_FORBIDDEN = ['acorn', 'acorn-jsx', 'lucide-solid', 'lucide-static', ...SQLITE];

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Static import/re-export specifiers of a module. Dynamic `import(...)` never
 * matches (it is a call, not a declaration), which is exactly the exemption
 * this test exists to enforce.
 */
function staticImports(src: string): string[] {
  const code = stripComments(src);
  const specs: string[] = [];
  // import ... from 'x' | export ... from 'x' — lazily spanning multi-line
  // specifier lists; `type` after the keyword marks an erased, type-only edge.
  const fromRe = /(?:^|\n)\s*(import|export)\s+([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = fromRe.exec(code); m; m = fromRe.exec(code)) {
    if (!/^type\b/.test(m[2].trim())) specs.push(m[3]);
  }
  // Side-effect imports: import 'x'
  const bareRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (let m = bareRe.exec(code); m; m = bareRe.exec(code)) specs.push(m[1]);
  return specs;
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

/** Resolve a specifier to a repo file, or classify it as an external package. */
function resolveSpec(spec: string, fromFile: string): { file?: string; pkg?: string } {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else {
    const parts = spec.split('/');
    return { pkg: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] };
  }
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (isFile(candidate)) return { file: candidate };
  }
  return {}; // css / yaml / assets — no imports to follow
}

interface Reach { files: Set<string>; packages: Map<string, string> /* pkg -> importing file */; parent: Map<string, string> }

function walk(entries: string[]): Reach {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const parent = new Map<string, string>();
  const queue = entries.map((e) => path.join(ROOT, e));
  for (const e of queue) files.add(e);
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      const r = resolveSpec(spec, file);
      if (r.pkg && !packages.has(r.pkg)) packages.set(r.pkg, file);
      if (r.file && !files.has(r.file)) {
        files.add(r.file);
        parent.set(r.file, file);
        queue.push(r.file);
      }
    }
  }
  return { files, packages, parent };
}

const chainTo = (file: string, parent: Map<string, string>): string => {
  const chain = [file];
  for (let p = parent.get(file); p; p = parent.get(p)) chain.unshift(p);
  return chain.map((f) => path.relative(ROOT, f)).join('\n    → ');
};

describe('reader bundle hygiene', () => {
  const reach = walk(READER_ENTRIES);

  it('sanity: the walker actually descends through the reader graph', () => {
    // Guards the guard: if import parsing breaks, the forbidden check would
    // pass vacuously. The page follows the live document through this primitive.
    expect([...reach.files].map((f) => path.relative(ROOT, f))).toContain(
      'solid/editor/create-live-artifact.ts',
    );
    expect([...reach.packages.keys()]).toContain('solid-js');
  });

  it('the editor and its panels stay out of the static reader graph through dynamic imports', () => {
    const editor = [...reach.files].map((f) => path.relative(ROOT, f))
      .filter((f) => f === 'solid/editor/InPlaceEditor.tsx' || f === 'solid/editor/ArtifactEditor.tsx' || f.startsWith('solid/editor/panels/'));
    expect(editor).toEqual([]);
  });

  it('keeps the dataset viewer out of the static text-reader graph', () => {
    const dataset = path.join(ROOT, 'solid/components/DatasetCatalogView.tsx');
    expect(reach.files.has(dataset) ? chainTo(dataset, reach.parent) : null).toBeNull();
  });

  it.each(FORBIDDEN)('never statically reaches %s', (pkg) => {
    const importer = reach.packages.get(pkg);
    expect(
      importer ? `${pkg} is statically imported via:\n    ${chainTo(importer, reach.parent)}` : null,
    ).toBeNull();
  });
});

describe('compiled document bundle hygiene', () => {
  const reach = walk(RUNTIME_ENTRY);

  it('sanity: the walker actually descends through the runtime graph', () => {
    // Guards the guard, exactly as above: a broken parse would make every
    // forbidden check below pass while importing nothing.
    expect([...reach.files].map((f) => path.relative(ROOT, f))).toContain(
      'lib/islands/live.ts',
    );
    expect([...reach.packages.keys()]).toContain('solid-js');
  });

  it.each(RUNTIME_FORBIDDEN)('never statically reaches %s', (pkg) => {
    const importer = reach.packages.get(pkg);
    expect(
      importer ? `${pkg} is statically imported via:\n    ${chainTo(importer, reach.parent)}` : null,
    ).toBeNull();
  });
});

/**
 * The /a/<id> READER ROUTE as the server preloads it (server/reader-preloads.ts)
 * plus the SPA shell: what every reader of every document downloads before the
 * page is theirs. Owner and on-demand features (sharing, the folder view, the
 * comment layer, the JSX parser that writing needs) load when first used, and
 * are prefetched on idle/hover so the first click does not wait.
 */
const ROUTE_ENTRIES = ['web/solid-spa-idle.ts', 'solid/main.tsx', 'solid/pages/Document.tsx', 'solid/pages/Profile.tsx'];
/*
 * css-tree (+ source-map-js) rewrote the document's CSS IN THE BROWSER — work the
 * server already did. The prepared page carries the rewritten sheet, so the
 * reader never parses CSS.
 */
const ROUTE_FORBIDDEN_PACKAGES = ['acorn', 'acorn-jsx', 'typebox', 'css-tree', 'source-map-js', ...FORBIDDEN];
const ROUTE_FORBIDDEN_FILES = ['solid/editor/InPlaceEditor.tsx', 'solid/document/SocialPreviewEditor.tsx', 'lib/jsx/parse.ts'];

describe('reader route bundle hygiene', () => {
  const reach = walk(ROUTE_ENTRIES);

  it('sanity: the walker descends through the SPA shell', () => {
    const files = [...reach.files].map((f) => path.relative(ROOT, f));
    expect(files).toContain('solid/App.tsx');
    expect([...reach.packages.keys()]).toContain('solid-js');
  });

  it('keeps the runtime class merger out of the reader route', () => {
    const merger = reach.packages.get('tailwind-merge');
    expect(merger ? chainTo(merger, reach.parent) : null).toBeNull();
  });

  it.each(ROUTE_FORBIDDEN_PACKAGES)('never statically reaches %s', (pkg) => {
    const importer = reach.packages.get(pkg);
    expect(importer ? `${pkg} is statically imported via:\n    ${chainTo(importer, reach.parent)}` : null).toBeNull();
  });

  it.each(ROUTE_FORBIDDEN_FILES)('loads %s only on demand', (rel) => {
    const file = path.join(ROOT, rel);
    expect(reach.files.has(file) ? chainTo(file, reach.parent) : null).toBeNull();
  });

  it('ships the Tailwind sheet once: no `?inline` CSS copy in the reader JS', () => {
    const inline = [...reach.files].filter((f) => staticImports(readFileSync(f, 'utf8')).some((s) => /\.css\?inline$/.test(s)));
    expect(inline.map((f) => chainTo(f, reach.parent))).toEqual([]);
  });
});
