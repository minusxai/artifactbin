/**
 * THE AUTHOR SCRIPT AS A MODULE, built at publish (and for a draft preview): Babel, then esbuild.
 *
 *  - JSX becomes Solid DOM code (babel-preset-solid, `generate: 'dom'`, no hydration, helpers from `solid-js/web`),
 *    the transform the island build runs over the kit;
 *  - `import { signal, query, mutation } from 'page'` resolves to a generated module that reads the page's bindings
 *    (lib/islands/page-runtime PAGE_GLOBAL). Every call names a declared name as the markup spells it
 *    (`signal('$region')`), checked here: an undeclared name, a name of the wrong kind or a computed argument is a
 *    publish error with the line, and so is `createSignal('$region')` (a local signal that only looks bound);
 *  - `solid-js`, `solid-js/web` and `solid-js/store` stay bare, limited to the names the island build's vendor chunks
 *    export (contract AUTHOR_VENDOR_EXPORTS): the runtime points them at the serving build's chunks when the module
 *    loads, so the script runs on the kit's one Solid;
 *  - any other bare specifier is a package on esm.sh (`three` → `https://esm.sh/three`), and a full URL is
 *    kept as written; a relative path is an error, since nothing sits beside the script.
 *
 * The result carries the module's named exports (the components the markup may mount) from esbuild's metafile.
 * Pure text in, text out: neither Babel nor esbuild runs author code.
 */
import { createHash } from 'node:crypto';
// The bundler is a TYPE import here and loads inside build(): a document without a script never starts it, and
// esbuild's import-time realm check (TextEncoder output instanceof the global Uint8Array) never runs in a jsdom
// test that publishes through jsx-tier — there the two come from different realms and the import itself throws.
import type * as esbuild from 'esbuild';
import { transformAsync, type PluginObj, type types as BabelTypes } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { AUTHOR_VENDOR_EXPORTS } from '@/lib/islands/contract';
import { PAGE_GLOBAL } from '@/lib/story-runtime/contract';
import type { HelmetContent } from '../../document/helmet';

/** Where a bare npm specifier resolves (`three` → `https://esm.sh/three`): the module host every script may load from. */
export const ESM_CDN_ORIGIN = 'https://esm.sh';
const PAGE_SPECIFIER = 'page';
/** The `page` exports that bind one declared name of their kind (`signal('$region')`). */
const PAGE_BINDERS = ['signal', 'query', 'mutation'] as const;
type PageExport = (typeof PAGE_BINDERS)[number];
/** Everything `page` exports: the binders, and `proxy(url)` (lib/islands/page-runtime pageProxyUrl), which takes any https URL. */
const PAGE_EXPORTS = [...PAGE_BINDERS, 'proxy', 'reviewState', 'upload', 'fileUrl', 'uploadImage', 'imageUrl'] as const;

/** The declared names by kind: `values` are scalar Values; `tables` are table Values (rows, like a Query). */
export interface AuthorModuleNames { values: string[]; tables?: string[]; queries: string[]; mutations: string[] }
export interface AuthorModule { code: string; exports: string[] }
export type AuthorModuleResult = { ok: true; module: AuthorModule } | { ok: false; errors: string[] };

/** The names a Helmet declares, as the publish checks need them. */
export function authorModuleNames(content: Pick<HelmetContent, 'values' | 'queries' | 'mutations'>): AuthorModuleNames {
  const scalar = (v: HelmetContent['values'][number]) => v.kind === 'scalar';
  return {
    values: content.values.filter(scalar).map((v) => v.name),
    tables: content.values.filter((v) => !scalar(v)).map((v) => v.name),
    queries: content.queries.map((q) => q.name),
    mutations: content.mutations.map((m) => m.name),
  };
}

const VENDOR: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries(AUTHOR_VENDOR_EXPORTS).map(([spec, names]) => [spec, new Set<string>(names)]),
);

/** The generated `page` module: the binders and `proxy`, read from the runtime's bindings at import. */
export function pageModuleSource(): string {
  return [
    `const b = globalThis[${JSON.stringify(PAGE_GLOBAL)}];`,
    `if (!b) throw new Error("the page module loads only inside a running document");`,
    ...PAGE_BINDERS.map((name) => `export const ${name} = (ref) => b.${name}(ref);`),
    `export const upload = (importName, file) => b.upload(importName, file);`,
    `export const fileUrl = (importName, ref) => b.fileUrl(importName, ref);`,
    `export const uploadImage = (importName, file) => b.uploadImage(importName, file);`,
    `export const imageUrl = (importName, ref) => b.imageUrl(importName, ref);`,
    `export const proxy = (url) => b.proxy(url);`,
    `export const reviewState = (part) => b.reviewState(part);`,
  ].join('\n') + '\n';
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

type Loc = { line: number; column: number } | null | undefined;
const at = (loc: Loc, message: string) => (loc ? `line ${loc.line}:${loc.column}: ${message}` : message);

/**
 * The publish checks over the AUTHOR's code, before the Solid transform touches it: what `page` binds, and
 * `createSignal('$x')`. Runs at Program entry, so it sees the script exactly as written.
 */
function pageCallsPlugin(names: AuthorModuleNames, errors: string[]): PluginObj {
  const kinds: Record<PageExport, { set: Set<string>; want: string; hint: (n: string) => string }> = {
    signal: { set: new Set(names.values), want: 'a scalar <Value>', hint: (n) => `const [${n}, set${n[0]!.toUpperCase()}${n.slice(1)}] = signal('$${n}')` },
    query: { set: new Set([...names.queries, ...(names.tables ?? [])]), want: 'a <Query> or a table <Value>', hint: (n) => `const ${n} = query('$${n}')` },
    mutation: { set: new Set(names.mutations), want: 'a <Mutation>', hint: (n) => `const ${n} = mutation('$${n}')` },
  };
  const kindOf = (name: string): PageExport | null => (Object.keys(kinds) as PageExport[]).find((k) => kinds[k].set.has(name)) ?? null;
  return {
    name: 'mx-page-calls',
    visitor: {
      Program(program) {
        const binders = new Map<string, PageExport>();
        const createSignals = new Set<string>();
        /** Locals bound by a page call: `region` and `setRegion` from `signal('$region')`, `monthly` from `query('$monthly')`. */
        const accessors = new Map<string, { kind: PageExport; setter?: string }>();
        for (const stmt of program.get('body')) {
          if (!stmt.isImportDeclaration()) continue;
          const source = stmt.node.source.value;
          for (const spec of stmt.node.specifiers) {
            if (source === PAGE_SPECIFIER) {
              if (spec.type !== 'ImportSpecifier') { errors.push(at(spec.loc?.start, `import from 'page' by name: import { ${PAGE_EXPORTS.join(', ')} } from 'page'`)); continue; }
              const imported = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
              if (!(PAGE_EXPORTS as readonly string[]).includes(imported)) {
                const kind = kindOf(imported);
                errors.push(at(spec.loc?.start, `'page' exports ${PAGE_EXPORTS.join(', ')}, not ${imported}` + (kind ? `; bind the declared name with ${kinds[kind].hint(imported)}` : '')));
                continue;
              }
              // `proxy` takes a URL, not a declared name: nothing to check at its calls.
              if ((PAGE_BINDERS as readonly string[]).includes(imported)) binders.set(spec.local.name, imported as PageExport);
            } else if (source === 'solid-js' && spec.type === 'ImportSpecifier') {
              const imported = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
              if (imported === 'createSignal') createSignals.add(spec.local.name);
            }
          }
        }
        program.traverse({
          Identifier(path) {
            const kind = binders.get(path.node.name);
            if (!kind || !path.isReferencedIdentifier() || path.scope.getBinding(path.node.name)?.kind !== 'module') return;
            const call = path.parentPath;
            if (!call?.isCallExpression() || call.node.callee !== path.node) {
              errors.push(at(path.node.loc?.start, `call ${kind}('$name') directly, with the declared name as a string`));
              return;
            }
            const [arg, ...rest] = call.node.arguments;
            const literal = arg?.type === 'StringLiteral' ? arg.value
              : arg?.type === 'TemplateLiteral' && arg.expressions.length === 0 ? arg.quasis[0]!.value.cooked ?? null : null;
            if (literal === null || rest.length) {
              errors.push(at(call.node.loc?.start, `${kind}(…) takes one string, the declared name as the markup spells it: ${kind}('$name')`));
              return;
            }
            const name = literal.startsWith('$') ? literal.slice(1) : null;
            const declared = name === null ? null : kindOf(name);
            if (name === null) errors.push(at(call.node.loc?.start, `${kind}(${JSON.stringify(literal)}): write the name as the markup does, with its $: ${kind}('$${literal}')`));
            else if (!declared) errors.push(at(call.node.loc?.start, `${kind}('$${name}'): the Helmet declares no ${name}`));
            else if (declared !== kind) errors.push(at(call.node.loc?.start, `${kind}('$${name}'): ${name} is ${kinds[declared].want}; ${kinds[declared].hint(name)}`));
            else {
              const decl = call.parentPath;
              if (decl?.isVariableDeclarator()) {
                const id = decl.node.id;
                if (id.type === 'Identifier') accessors.set(id.name, { kind });
                else if (id.type === 'ArrayPattern' && id.elements[0]?.type === 'Identifier') {
                  const setter = id.elements[1]?.type === 'Identifier' ? id.elements[1].name : undefined;
                  accessors.set(id.elements[0].name, { kind, setter });
                }
              }
            }
          },
          CallExpression(path) {
            const callee = path.node.callee;
            if (callee.type !== 'Identifier' || !createSignals.has(callee.name) || path.scope.getBinding(callee.name)?.kind !== 'module') return;
            const arg = path.node.arguments[0];
            const text = arg?.type === 'StringLiteral' ? arg.value : arg?.type === 'TemplateLiteral' && arg.expressions.length === 0 ? arg.quasis[0]!.value.cooked ?? '' : null;
            if (text?.startsWith('$')) {
              errors.push(at(path.node.loc?.start, `createSignal(${JSON.stringify(text)}) makes a local signal holding that string, bound to nothing; bind the declared Value with signal('${text}') from 'page'`));
            }
          },
        });
        // Second pass, with the bound locals known: a binding is an accessor, never a `.value` box, and an exported
        // component reads its props as `props.x` (destructuring freezes them, the Solid trap the models fall into).
        program.traverse({
          MemberExpression(path) {
            const { object, property } = path.node;
            if (property.type !== 'Identifier' || property.name !== 'value') return;
            const base = object.type === 'Identifier' ? object
              : object.type === 'MemberExpression' && object.object.type === 'Identifier' && object.property.type === 'Identifier' && ['loading', 'error'].includes(object.property.name) ? object.object : null;
            if (!base || !accessors.has(base.name) || path.scope.getBinding(base.name)?.kind !== 'const' && path.scope.getBinding(base.name)?.kind !== 'let') return;
            const bound = accessors.get(base.name)!;
            const sub = object.type === 'MemberExpression' && object.property.type === 'Identifier' ? `.${object.property.name}` : '';
            const read = `${base.name}${sub}()`;
            const write = bound.setter ? `; write with ${bound.setter}(v)` : '';
            errors.push(at(path.node.loc?.start, `${base.name}${sub}.value: ${base.name} is a Solid accessor, not a signal object; read with ${read}${write}`));
          },
          ExportNamedDeclaration(path) {
            const decl = path.node.declaration;
            const fns: Array<{ name: string; params: unknown[]; loc: { line: number; column: number } | undefined }> = [];
            if (decl?.type === 'FunctionDeclaration' && decl.id) fns.push({ name: decl.id.name, params: decl.params, loc: decl.loc?.start });
            if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations) {
              if (d.id.type === 'Identifier' && d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')) fns.push({ name: d.id.name, params: d.init.params, loc: d.loc?.start });
            }
            for (const fn of fns) {
              if (/^[A-Z]/.test(fn.name) && (fn.params[0] as { type?: string } | undefined)?.type === 'ObjectPattern') {
                errors.push(at(fn.loc, `${fn.name}({ … }): a Solid component reads its props as props.name; destructuring them freezes their first value. Write ${fn.name}(props)`));
              }
            }
          },
        });
      },
    },
  };
}

/** The transformed module's Solid imports must be names the vendor chunks export (a missing one fails at link time). */
function checkVendorImports(ast: BabelTypes.File, errors: string[]): void {
  for (const stmt of ast.program.body) {
    if ((stmt.type !== 'ImportDeclaration' && stmt.type !== 'ExportNamedDeclaration' && stmt.type !== 'ExportAllDeclaration') || !stmt.source) continue;
    const allowed = VENDOR[stmt.source.value];
    if (!allowed) continue;
    if (stmt.type === 'ExportAllDeclaration') { errors.push(at(stmt.loc?.start, `export * from '${stmt.source.value}': re-export Solid by name`)); continue; }
    for (const spec of stmt.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') { errors.push(at(spec.loc?.start, `'${stmt.source.value}' has no default export`)); continue; }
      if (spec.type === 'ImportNamespaceSpecifier' || spec.type === 'ExportNamespaceSpecifier' || spec.type === 'ExportDefaultSpecifier') continue;
      const ref = spec.type === 'ImportSpecifier' ? spec.imported : spec.local;
      const name = ref.type === 'Identifier' ? ref.name : ref.value;
      if (!allowed.has(name)) errors.push(at(spec.loc?.start, `'${stmt.source.value}' offers ${[...allowed].join(', ')} to a page script; ${name} is not among them`));
    }
  }
}

const babelMessage = (error: unknown): string => {
  const e = error as { message?: string; loc?: Loc; reasonCode?: string };
  const first = (e.message ?? String(error)).split('\n')[0]!.replace(/^[^:]*helmet-script\.jsx:\s*/, '').replace(/\s*\(\d+:\d+\)$/, '');
  return at(e.loc, first);
};

async function build(script: string, names: AuthorModuleNames): Promise<AuthorModuleResult> {
  const { build: bundle } = await import('esbuild');
  const errors: string[] = [];
  let transformed: string;
  try {
    const out = await transformAsync(script, {
      filename: 'helmet-script.jsx', babelrc: false, configFile: false, sourceType: 'module', compact: false, ast: true, retainLines: true,
      // The cwd Babel would otherwise read: the output is then the same on every machine (the served bytes are compared).
      cwd: '/', root: '/',
      plugins: [pageCallsPlugin(names, errors)],
      presets: [[solidPreset, { generate: 'dom', hydratable: false, moduleName: 'solid-js/web' }]],
    });
    if (!out?.code || !out.ast) return { ok: false, errors: ['the script did not transform'] };
    checkVendorImports(out.ast, errors);
    if (errors.length) return { ok: false, errors };
    transformed = out.code;
  } catch (error) {
    return { ok: false, errors: [...errors, babelMessage(error)] };
  }
  const plugin: esbuild.Plugin = {
    name: 'mx-page',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return undefined;
        const spec = args.path;
        if (spec === PAGE_SPECIFIER) return { path: spec, namespace: PAGE_SPECIFIER };
        if (VENDOR[spec]) return { path: spec, external: true };
        if (/^https?:\/\//.test(spec)) return { path: spec, external: true };
        if (spec.startsWith('.') || spec.startsWith('/')) {
          errors.push(`import "${spec}": nothing sits beside the script; import a package by name or a module by URL`);
          return { path: spec, external: true };
        }
        if (/^solid-js(\/|$)/.test(spec)) {
          errors.push(`import "${spec}": a page script imports Solid as ${Object.keys(VENDOR).join(', ')}`);
          return { path: spec, external: true };
        }
        if (/^(preact|react|react-dom)(\/|$)|^@preact\//.test(spec)) {
          errors.push(`import "${spec}": a page script is Solid; there is no Preact or React here. Use createSignal, createEffect, createMemo, For and Show from 'solid-js', and signal('$name')/query('$name')/mutation('$name') from 'page'`);
          return { path: spec, external: true };
        }
        if (/^[@\w][\w./@-]*$/.test(spec)) return { path: `${ESM_CDN_ORIGIN}/${spec}`, external: true };
        errors.push(`import "${spec}": not a package name or a URL`);
        return { path: spec, external: true };
      });
      b.onLoad({ filter: /.*/, namespace: PAGE_SPECIFIER }, () => ({ contents: pageModuleSource(), loader: 'js' }));
    },
  };
  try {
    const result = await bundle({
      // absWorkingDir: the module's leading path comment is then the same on every machine (the served bytes are compared).
      absWorkingDir: '/', stdin: { contents: transformed, loader: 'js', sourcefile: 'helmet-script.jsx', resolveDir: '/' },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true,
      logLevel: 'silent', plugins: [plugin], outfile: 'author-module.js',
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
