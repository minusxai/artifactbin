/**
 * What the served document's runtime build knows about its own chunk graph,
 * read out of esbuild's metafile and Mermaid's own dispatch code, for
 * scripts/build-story-runtime.mjs to record in public/story/manifest.json.
 *
 * A document can only preload what it can NAME at render time. The entry names
 * its static chunks only once it has downloaded and parsed; Mermaid names a
 * diagram's module only once it has detected the kind, and that module names
 * its layout engine only once it runs. Each of those is a round trip a reader
 * waits through, so the build writes the whole chain down here instead.
 */
import fs from 'node:fs';
import path from 'node:path';

/** esbuild's own names for an output's static imports (never `dynamic-import`). */
const STATIC = new Set(['import-statement', 'require-call']);

/**
 * `start` and every output it imports statically, transitively, in discovery
 * order. Metafile output keys are paths relative to the working directory.
 */
export function staticClosure(outputs, start) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    if (!outputs[key]) throw new Error(`story-runtime-graph: no output ${key} in the metafile`);
    seen.add(key);
    for (const i of outputs[key].imports ?? []) if (STATIC.has(i.kind) && !i.external) visit(i.path);
  };
  visit(start);
  return [...seen];
}

/** The output esbuild split off for `module` (a `import()` target), found by its entry point. */
export function outputFor(outputs, matches) {
  const found = Object.entries(outputs).filter(([, out]) => out.entryPoint && matches(out.entryPoint.split(path.sep).join('/')));
  if (found.length !== 1) throw new Error(`story-runtime-graph: expected one output, found ${found.length}`);
  return found[0][0];
}

/**
 * Mermaid's dispatch, read from the installed package rather than remembered:
 * each detector id → the diagram module its loader imports, and each layout
 * engine name → the module ITS loader imports. A Mermaid upgrade renames every
 * hashed module; reading them here means an upgrade changes this map, never
 * silently empties it — a kind or layout the kit declares that Mermaid no
 * longer ships is a build failure.
 */
export function mermaidDispatch(mermaidDist) {
  const core = fs.readFileSync(path.join(mermaidDist, 'mermaid.core.mjs'), 'utf8');
  const diagrams = {};
  for (const section of core.split(/\nvar id\d* = /).slice(1)) {
    const id = /^"([^"]+)";/.exec(section)?.[1];
    const module = /import\("\.\/chunks\/mermaid\.core\/([^"]+\.mjs)"\)/.exec(section)?.[1];
    if (id && module) diagrams[id] = module;
  }
  const chunks = path.join(mermaidDist, 'chunks/mermaid.core');
  const registry = fs.readdirSync(chunks).filter((f) => f.endsWith('.mjs'))
    .map((f) => fs.readFileSync(path.join(chunks, f), 'utf8'))
    .find((text) => text.includes('registerDefaultLayoutLoaders'));
  if (!registry) throw new Error('story-runtime-graph: Mermaid\'s layout registry was not found');
  const layouts = {};
  for (const [, name, module] of registry.matchAll(/name: "([\w.-]+)",\s*loader: [^\n]*import\("\.\/([^"]+\.mjs)"\)/g)) layouts[name] = module;
  const elk = /elkLayoutLoaders = [\s\S]*?import\("\.\/([^"]+\.mjs)"\)[\s\S]*?name: "elk"/.exec(registry)?.[1];
  if (elk) layouts.elk = elk;
  return { diagrams, layouts };
}

/**
 * Each diagram kind's full static closure: the kit's engine (mermaid-render),
 * the kind's own diagram module, and the layout engine(s) it draws with.
 * Returned as Mermaid module names per kind, so the SPA build (whose chunks
 * have other names) can resolve the same modules through its own manifest.
 */
export function mermaidKindModules(kinds, dispatch) {
  const modules = {};
  for (const { kind, mermaid, layouts } of kinds) {
    const diagram = dispatch.diagrams[mermaid];
    if (!diagram) throw new Error(`story-runtime-graph: Mermaid has no diagram "${mermaid}" for the kind "${kind}"`);
    modules[kind] = [diagram, ...layouts.map((layout) => {
      const module = dispatch.layouts[layout];
      if (!module) throw new Error(`story-runtime-graph: Mermaid has no layout "${layout}" for the kind "${kind}"`);
      return module;
    })];
  }
  return modules;
}
