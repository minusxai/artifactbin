/** Resolve Mermaid's diagram and layout modules for the server's Vite preload hints. */
import fs from 'node:fs';
import path from 'node:path';

/** A bundled file as the path below its `node_modules/`, e.g. `mermaid/dist/mermaid.core.mjs`. */
export const packagePath = (file) => file.split(path.sep).join('/').split('/node_modules/').pop();

/**
 * Mermaid's dispatch, read from the files this build actually bundled rather
 * than remembered: each detector id → the diagram module its loader imports;
 * each layout engine → the module ITS loader imports; and each diagram module
 * that parses with a Langium grammar (@mermaid-js/parser `parse("pie", …)`) →
 * the grammar module the parser imports for it. A Mermaid upgrade renames
 * every hashed module; reading them here means an upgrade changes this map,
 * never silently empties it — a kind or layout the kit declares that Mermaid
 * no longer ships is a build failure.
 *
 * Every module is named by its path below `node_modules/`, which both this
 * build (esbuild's entry points) and the app's (Vite's manifest keys) end with.
 */
export function mermaidDispatch(coreFile, parserFile) {
  const read = (file) => fs.readFileSync(file, 'utf8');
  const beside = (file, relative) => packagePath(path.join(path.dirname(file), relative));
  const core = read(coreFile);
  const diagrams = {}, diagramFiles = {};
  for (const section of core.split(/\nvar id\d* = /).slice(1)) {
    const id = /^"([^"]+)";/.exec(section)?.[1];
    const module = /import\("(\.\/chunks\/mermaid\.core\/[^"]+\.mjs)"\)/.exec(section)?.[1];
    if (id && module) {
      diagrams[id] = beside(coreFile, module);
      diagramFiles[id] = path.join(path.dirname(coreFile), module);
    }
  }
  const chunks = path.join(path.dirname(coreFile), 'chunks/mermaid.core');
  const registry = fs.readdirSync(chunks).filter((f) => f.endsWith('.mjs')).map((f) => path.join(chunks, f))
    .find((file) => read(file).includes('registerDefaultLayoutLoaders'));
  if (!registry) throw new Error('mermaid-graph: Mermaid\'s layout registry was not found');
  const layouts = {};
  const loaders = read(registry);
  for (const [, name, module] of loaders.matchAll(/name: "([\w.-]+)",\s*loader: [^\n]*import\("(\.\/[^"]+\.mjs)"\)/g)) layouts[name] = beside(registry, module);
  const elk = /elkLayoutLoaders = [\s\S]*?import\("(\.\/[^"]+\.mjs)"\)[\s\S]*?name: "elk"/.exec(loaders)?.[1];
  if (elk) layouts.elk = beside(registry, elk);
  const parser = read(parserFile);
  const grammarModules = {};
  for (const [, name, module] of parser.matchAll(/\n {2}(\w+): [^\n]*async \(\) => \{\n[^\n]*import\("(\.\/[^"]+\.mjs)"\)/g)) grammarModules[name] = beside(parserFile, module);
  if (!Object.keys(grammarModules).length) throw new Error('mermaid-graph: @mermaid-js/parser\'s grammar loaders were not found');
  const grammars = {};
  for (const [id, file] of Object.entries(diagramFiles)) {
    const source = read(file);
    if (!source.includes('"@mermaid-js/parser"')) continue;
    const used = Object.keys(grammarModules).filter((name) => new RegExp(`\\(\\s*"${name}"\\s*,`).test(source));
    if (used.length) grammars[id] = used.map((name) => grammarModules[name]);
  }
  return { diagrams, layouts, grammars };
}

/**
 * Each diagram kind's Mermaid modules: its own diagram module, the grammar the
 * parser loads for it, and the layout engine(s) it draws with — what Mermaid
 * `import()`s after the engine detects the kind. By package path, so the SPA
 * build (whose chunks have other names) resolves the same modules through its
 * own manifest.
 */
export function mermaidKindModules(kinds, dispatch) {
  const modules = {};
  for (const { kind, mermaid, layouts } of kinds) {
    const diagram = dispatch.diagrams[mermaid];
    if (!diagram) throw new Error(`mermaid-graph: Mermaid has no diagram "${mermaid}" for the kind "${kind}"`);
    modules[kind] = [diagram, ...dispatch.grammars[mermaid] ?? [], ...layouts.map((layout) => {
      const module = dispatch.layouts[layout];
      if (!module) throw new Error(`mermaid-graph: Mermaid has no layout "${layout}" for the kind "${kind}"`);
      return module;
    })];
  }
  return modules;
}
