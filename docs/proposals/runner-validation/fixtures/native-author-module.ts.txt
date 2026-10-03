/**
 * THE AUTHOR SCRIPT AS A MODULE, built at publish (and for a draft preview) with esbuild:
 *
 *  - JSX becomes Preact calls (`preact/jsx-runtime`, automatic runtime);
 *  - `import { region, monthly, rename } from 'page'` resolves to a generated module that reads the page's
 *    bindings (lib/islands/page-runtime PAGE_GLOBAL) and exports the declared names, so an undeclared name
 *    is a build error here, at publish, with the name in the message;
 *  - the vendor specifiers (`preact`, `preact/hooks`, `preact/compat`, `preact/jsx-runtime`, `@preact/signals`,
 *    and `react`, `react-dom`, `react/jsx-runtime` as their compat spellings) stay bare: the runtime points
 *    them at the serving build's chunks when the module loads;
 *  - any other bare specifier is a package on esm.sh (`three` → `https://esm.sh/three`), and a full URL is
 *    kept as written; a relative path is an error, since nothing sits beside the script.
 *
 * The result carries the module's named exports (the components the markup may mount) from esbuild's metafile.
 * Pure text in, text out: no author code runs here.
 */
import { createHash } from 'node:crypto';
// The bundler is a TYPE import here and loads inside build(): a document without a script never starts it, and
// esbuild's import-time realm check (TextEncoder output instanceof the global Uint8Array) never runs in a jsdom
// test that publishes through jsx-tier — there the two come from different realms and the import itself throws.
import type * as esbuild from 'esbuild';

export const PAGE_GLOBAL = '__mxPageBindings';
export const PAGE_SPECIFIER = 'page';

/** Spellings the runtime resolves to the build's chunks (`react*` → preact/compat). */
export const VENDOR_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  preact: 'preact', 'preact/hooks': 'preact/hooks', 'preact/compat': 'preact/compat', 'preact/jsx-runtime': 'preact/jsx-runtime',
  '@preact/signals': '@preact/signals', '@preact/signals-core': '@preact/signals',
  react: 'preact/compat', 'react-dom': 'preact/compat', 'react-dom/client': 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime',
});

export interface AuthorModuleNames { values: string[]; queries: string[]; mutations: string[] }
export interface AuthorModule { code: string; exports: string[] }
export type AuthorModuleResult = { ok: true; module: AuthorModule } | { ok: false; errors: string[] };

const NAME_RE = /^[A-Za-z_]\w*$/;

/** The generated `page` module: one export per declared name, read from the runtime's bindings at import. */
export function pageModuleSource(names: AuthorModuleNames): string {
  const lines = [`const b = globalThis[${JSON.stringify(PAGE_GLOBAL)}];`, `if (!b) throw new Error("the page module loads only inside a running document");`];
  const seen = new Set<string>();
  const add = (name: string, expr: string) => {
    if (!NAME_RE.test(name) || seen.has(name)) return;
    seen.add(name);
    lines.push(`export const ${name} = b.${expr}(${JSON.stringify(name)});`);
  };
  for (const name of names.values) add(name, 'signal');
  for (const name of names.queries) add(name, 'query');
  for (const name of names.mutations) add(name, 'mutation');
  return lines.join('\n') + '\n';
}

const cache = new Map<string, AuthorModuleResult>();
const CACHE_MAX = 256;

export async function buildAuthorModule(script: string, names: AuthorModuleNames): Promise<AuthorModuleResult> {
  const key = createHash('sha256').update(JSON.stringify([script, names])).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const result = await build(script, names);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, result);
  return result;
}

async function build(script: string, names: AuthorModuleNames): Promise<AuthorModuleResult> {
  const { build: bundle } = await import('esbuild');
  const errors: string[] = [];
  const plugin: esbuild.Plugin = {
    name: 'mx-page',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined;
        const spec = args.path;
        if (spec === PAGE_SPECIFIER) return { path: spec, namespace: PAGE_SPECIFIER };
        if (VENDOR_ALIASES[spec]) return { path: VENDOR_ALIASES[spec]!, external: true };
        if (/^https?:\/\//.test(spec)) return { path: spec, external: true };
        if (spec.startsWith('.') || spec.startsWith('/')) {
          errors.push(`import "${spec}": nothing sits beside the script; import a package by name or a module by URL`);
          return { path: spec, external: true };
        }
        if (/^[@\w][\w./@-]*$/.test(spec)) return { path: `https://esm.sh/${spec}`, external: true };
        errors.push(`import "${spec}": not a package name or a URL`);
        return { path: spec, external: true };
      });
      b.onLoad({ filter: /.*/, namespace: PAGE_SPECIFIER }, () => ({ contents: pageModuleSource(names), loader: 'js' }));
    },
  };
  try {
    const result = await bundle({
      // absWorkingDir: the module's leading path comment is then the same on every machine (the served bytes are compared).
      absWorkingDir: '/', stdin: { contents: script, loader: 'jsx', sourcefile: 'helmet-script.jsx', resolveDir: '/' },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true,
      jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'silent', plugins: [plugin], outfile: 'author-module.js',
    });
    if (errors.length) return { ok: false, errors };
    const output = Object.values(result.metafile.outputs)[0];
    const code = result.outputFiles[0]?.text ?? '';
    return { ok: true, module: { code, exports: [...(output?.exports ?? [])].sort() } };
  } catch (error) {
    const failure = error as { errors?: Array<{ text: string; location?: { line: number; column: number; lineText?: string } | null }> };
    const messages = (failure.errors ?? []).map((e) => e.location ? `line ${e.location.line}:${e.location.column}: ${e.text}` : e.text);
    return { ok: false, errors: [...errors, ...(messages.length ? messages : [error instanceof Error ? error.message : String(error)])] };
  }
}
