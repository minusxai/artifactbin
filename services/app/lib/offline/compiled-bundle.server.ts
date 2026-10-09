/** Pack one stored compiled browser module into a classic script for file://.
 * The compiler remains the sole owner of document code, and nothing is bundled at download: the
 * shared runtime is the island build's OFFLINE HALF (scripts/build/build-islands.mjs buildOfflineHalf — every
 * chunk a CommonJS factory, `@mx/boot` the snapshot-only file boot), and the document's own module is
 * turned into a function of its imports by the same Babel pass that evaluates SSR modules. The file
 * carries a tiny loader, the factories of the closure the module needs, and the module.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { transformAsync, type types as BabelTypes } from '@babel/core';
import type { CompiledPage } from '@/lib/compiled-page/contract';
import { moduleToFunction } from '@/lib/compiled-page/bundle.server';
import { ISLANDS_MANIFEST_PATH } from '@/lib/compiled-page/build.server';
import { createModuleStore, createTemplateResourceStore } from '@/lib/compiled-page/modules.server';

const TEMPLATE = /["']\/islands\/t\/([0-9a-f]{16})\.json["']/g;
const OFFLINE_HALF = /^\/islands\/(offline-[0-9a-f]{16}\.json\.gzip)$/;

/** The island build's offline half, as scripts/build/build-islands.mjs writes it. */
export interface OfflineHalf {
  /** Import specifier → module id. */
  entries: Record<string, string>;
  /** The engines only the file's boot reaches, packed only when the file needs them. */
  lazy: { sqlite: string; chart: string };
  /** Module id → its CommonJS factory body and the ids it requires statically and lazily. */
  modules: Record<string, { code: string; imports: string[]; dynamic: string[] }>;
}

interface PackedCompiledModule {
  /** A single inline, classic script. No import, worker, blob or fetch is needed to execute it. */
  code: string;
  /** DOM factories externalized by the compiler, keyed as rt.templateFromPage reads them. */
  templates: Record<string, string>;
}

const halves = new Map<string, Promise<OfflineHalf>>();

/** The current build's offline half (read and parsed once per process per build). */
export function loadOfflineHalf(root = process.cwd()): Promise<OfflineHalf> {
  return (async () => {
    const manifest = JSON.parse(await readFile(path.resolve(root, ISLANDS_MANIFEST_PATH), 'utf8')) as { offline?: unknown };
    const name = typeof manifest.offline === 'string' ? OFFLINE_HALF.exec(manifest.offline)?.[1] : undefined;
    if (!name) throw new Error('offline: the island build has no offline half (run npm run build:islands)');
    const file = path.resolve(root, path.dirname(ISLANDS_MANIFEST_PATH), name);
    let half = halves.get(file);
    if (!half) {
      half = readFile(file).then((bytes) => JSON.parse(gunzipSync(bytes).toString('utf8')) as OfflineHalf);
      halves.set(file, half);
      half.catch(() => { if (halves.get(file) === half) halves.delete(file); });
    }
    return half;
  })();
}

/** Defines the factories and requires them on demand; `require` of a module the file lacks throws (a lazy import then rejects). */
const LOADER = '(function(g){var d={},c={};g.__mxOfflineDefine=function(i,f){d[i]=f};'
  + 'var r=g.__mxOfflineRequire=function(i){i=String(i).replace(/^\\.\\//,"");var m=c[i];if(m)return m.exports;var f=d[i];'
  + 'if(!f)throw new Error("offline: "+i+" is not in this file");m=c[i]={exports:{}};f.call(m.exports,m,m.exports,r);return m.exports};})(self);';

/** The document module as a function body of `__mx_import`, and the specifiers it imports. */
async function documentFunction(source: string): Promise<{ body: string; specifiers: string[] }> {
  const out = await transformAsync(source, {
    filename: 'offline-document.js', babelrc: false, configFile: false, sourceType: 'module', compact: true, comments: false,
    parserOpts: { allowReturnOutsideFunction: true },
    plugins: [({ types }: { types: typeof BabelTypes }) => moduleToFunction(types, { sideEffects: true })],
  });
  if (!out?.code) throw new Error('offline: the compiled module produced nothing');
  const specifiers = [...new Set([...out.code.matchAll(/__mx_import\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => JSON.parse(`"${m[1]}"`) as string))];
  return { body: out.code, specifiers };
}

export async function packCompiledBrowserModule(
  page: CompiledPage,
  options: {
    module?: Uint8Array;
    template?: (sha: string) => Promise<Uint8Array | null>;
    /** The offline half to pack against (tests); the current build's otherwise. */
    half?: OfflineHalf;
    /** Which boot-only engines travel: SQLite for held imports, Vega for charts. */
    offline?: { sqlite: boolean; chart: boolean };
  } = {},
): Promise<PackedCompiledModule | null> {
  if (!page.module) return null;
  const module = options.module ?? await createModuleStore().get(page.module.sha);
  if (!module) throw new Error(`offline: compiled module ${page.module.sha} is unavailable`);
  const source = new TextDecoder().decode(module);
  const templates: Record<string, string> = {};
  for (const sha of new Set([...source.matchAll(TEMPLATE)].map((match) => match[1]!))) {
    const bytes = await (options.template?.(sha) ?? createTemplateResourceStore().get(sha));
    if (!bytes) throw new Error(`offline: compiled templates ${sha} are unavailable`);
    Object.assign(templates, JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>);
  }
  // A null resource makes rt.templateFromPage read the inert inline templates.
  const { body, specifiers } = await documentFunction(source.replace(TEMPLATE, 'null'));
  const half = options.half ?? await loadOfflineHalf();
  // A module of the current contract names the runtime by specifier; an older one names its pinned build's chunk URLs.
  const pinned = new Map(Object.entries(page.sharedBuild?.manifest ?? {}).map(([specifier, url]) => [url, specifier]));
  const ids: Record<string, string> = {};
  for (const specifier of specifiers) {
    const id = half.entries[pinned.get(specifier) ?? specifier];
    if (!id) throw new Error(`offline: compiled module imports an unpinned asset: ${specifier}`);
    ids[specifier] = id;
  }
  const skipped = new Set([...(options.offline?.sqlite ? [] : [half.lazy.sqlite]), ...(options.offline?.chart ? [] : [half.lazy.chart])]);
  const closure = new Set<string>();
  const visit = (id: string) => {
    if (closure.has(id)) return;
    const entry = half.modules[id];
    if (!entry) throw new Error(`offline: the offline half has no module ${id}`);
    closure.add(id);
    for (const next of entry.imports) visit(next);
    for (const next of entry.dynamic) if (!skipped.has(next)) visit(next);
  };
  for (const id of Object.values(ids)) visit(id);
  const flags = { sqlite: !!options.offline?.sqlite, chart: !!options.offline?.chart };
  const code = LOADER + `self.__mxOfflineFlags=${JSON.stringify(flags)};\n`
    + [...closure].sort().map((id) => `__mxOfflineDefine(${JSON.stringify(id)},function(module,exports,require){"use strict";${half.modules[id]!.code}\n});\n`).join('')
    + `(function(__mx_import){"use strict";${body}\n})(function(s){return __mxOfflineRequire(${JSON.stringify(ids)}[s])});\n`;
  return { code, templates };
}
