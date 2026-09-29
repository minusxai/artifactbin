/** Pack one stored compiled browser module into a classic script for file://.
 * The compiler remains the sole owner of document code. This reads only the
 * module and the immutable shared build named by that compiled page.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import esbuild from 'esbuild';
import type { CompiledPage } from '@/lib/compiled-page/contract';
import { createModuleStore, createTemplateResourceStore } from '@/lib/compiled-page/modules.server';

const SHARED = /^\/islands\/([A-Za-z0-9_-]+\.js)$/;
const TEMPLATE = /["']\/islands\/t\/([0-9a-f]{16})\.json["']/g;

export interface PackedCompiledModule {
  /** A single inline, classic script. No import, worker, blob or fetch is needed to execute it. */
  code: string;
  /** DOM factories externalized by the compiler, keyed as rt.templateFromPage reads them. */
  templates: Record<string, string>;
}

export async function packCompiledBrowserModule(
  page: CompiledPage,
  options: {
    module?: Uint8Array;
    sharedDir?: string;
    template?: (sha: string) => Promise<Uint8Array | null>;
  } = {},
): Promise<PackedCompiledModule | null> {
  if (!page.module) return null;
  const module = options.module ?? await createModuleStore().get(page.module.sha);
  if (!module) throw new Error(`offline: compiled module ${page.module.sha} is unavailable`);
  const source = new TextDecoder().decode(module);
  const templateIds = [...source.matchAll(TEMPLATE)].map((match) => match[1]!);
  const templates: Record<string, string> = {};
  for (const sha of new Set(templateIds)) {
    const bytes = await (options.template?.(sha) ?? createTemplateResourceStore().get(sha));
    if (!bytes) throw new Error(`offline: compiled templates ${sha} are unavailable`);
    Object.assign(templates, JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>);
  }
  // A null resource makes rt.templateFromPage read the inert inline templates.
  const inlineSource = source.replace(TEMPLATE, 'null');
  const allowed = new Set(Object.values(page.sharedBuild?.manifest ?? {}));
  for (const url of page.module.imports) allowed.add(url);
  const sharedDir = options.sharedDir ?? path.join(process.cwd(), 'public', 'islands');
  const result = await esbuild.build({
    stdin: { contents: inlineSource, resolveDir: sharedDir, sourcefile: 'offline-compiled-entry.js', loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    plugins: [{
      name: 'pinned-offline-islands',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const absolute = args.path.startsWith('/islands/') ? args.path
            : args.path.startsWith('./') && args.importer.startsWith('/islands/')
              ? `/islands/${path.posix.basename(args.path)}` : null;
          const pinnedParent = args.namespace === 'pinned-island' && allowed.has(args.importer);
          if (!absolute || !SHARED.test(absolute) || (!allowed.has(absolute) && !pinnedParent)) {
            throw new Error(`offline: compiled module imports an unpinned asset: ${args.path}`);
          }
          // Relative imports are part of the pinned, content-addressed parent's
          // immutable graph. Admit their own relative imports by the same rule.
          allowed.add(absolute);
          return { path: absolute, namespace: 'pinned-island' };
        });
        build.onLoad({ filter: /.*/, namespace: 'pinned-island' }, async (args) => {
          const name = SHARED.exec(args.path)?.[1];
          if (!name) throw new Error(`offline: invalid island path ${args.path}`);
          return { contents: await readFile(path.join(sharedDir, name)), loader: 'js' };
        });
      },
    }],
    logLevel: 'silent',
  });
  return { code: result.outputFiles[0]!.text, templates };
}
