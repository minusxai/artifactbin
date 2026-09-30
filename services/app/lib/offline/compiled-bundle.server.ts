/** Pack one stored compiled browser module into a classic script for file://.
 * The compiler remains the sole owner of document code. This reads only the
 * module and the immutable shared build named by that compiled page.
 */
import { bindModuleCode } from '@/lib/compiled-page/runtime-binding';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import type { CompiledPage } from '@/lib/compiled-page/contract';
import { createModuleStore, createTemplateResourceStore } from '@/lib/compiled-page/modules.server';

const SHARED = /^\/islands\/([A-Za-z0-9_-]+\.js)$/;
const TEMPLATE = /["']\/islands\/t\/([0-9a-f]{16})\.json["']/g;

/**
 * `@artifactbin/<name>[/subpath]` → absolute file, read from each sibling workspace package's own
 * package.json "exports" map — the same technique the production bundler's static build aliases
 * with (artifactbin-server scripts/source-api.mjs sourceAliases). This build is a separate, LIVE
 * esbuild invocation (below): a compiled document that reaches `@artifactbin/sql/core` or
 * `@artifactbin/contracts` has nothing else to resolve those bare specifiers with, since production
 * never installs `@artifactbin/*` as an npm package (it ships whole into application.mjs instead) —
 * only `root`'s sibling package directories, copied there for this exact purpose.
 */
function siblingAliases(root: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of ['contracts', 'utils', 'sql']) {
    const source = path.join(root, name);
    let manifest: { exports?: Record<string, string> };
    try { manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')); } catch { continue; }
    for (const [sub, file] of Object.entries(manifest.exports ?? {})) {
      aliases[`@artifactbin/${name}${sub === '.' ? '' : sub.slice(1)}`] = path.join(source, file);
    }
  }
  return aliases;
}

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
    /** The directory holding the sibling `contracts`/`utils`/`sql` workspace packages (tests only; defaults to `..` of cwd). */
    workspaceRoot?: string;
    template?: (sha: string) => Promise<Uint8Array | null>;
    /** Swap the network reader boot for the snapshot-only file boot. */
    offline?: { sqlite: boolean; chart: boolean };
  } = {},
): Promise<PackedCompiledModule | null> {
  if (!page.module) return null;
  const module = options.module ?? await createModuleStore().get(page.module.sha);
  if (!module) throw new Error(`offline: compiled module ${page.module.sha} is unavailable`);
  const decoded = new TextDecoder().decode(module);
  // A module of the current contract names the runtime by specifier; the file pins the build it was exported with.
  const source = page.sharedBuild ? bindModuleCode(decoded, page.sharedBuild) : decoded;
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
  const bootUrl = page.sharedBuild?.manifest['@mx/boot'];
  const rtUrl = page.sharedBuild?.manifest['@mx/rt'];
  const sharedDir = options.sharedDir ?? path.join(process.cwd(), 'public', 'islands');
  const result = await esbuild.build({
    stdin: { contents: inlineSource, resolveDir: sharedDir, sourcefile: 'offline-compiled-entry.js', loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    alias: { '@': process.cwd(), ...siblingAliases(options.workspaceRoot ?? path.dirname(process.cwd())) },
    define: {
      __AFBIN_OFFLINE_SQLITE__: String(options.offline?.sqlite ?? false),
      __AFBIN_OFFLINE_CHART__: String(options.offline?.chart ?? false),
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [{
      name: 'pinned-offline-islands',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (options.offline && args.path === '@/lib/islands/rt' && args.importer.endsWith('/compiled-boot.ts')) {
            if (!rtUrl) throw new Error('offline: the compiled build has no runtime');
            return { path: rtUrl, namespace: 'pinned-island' };
          }
          if (!args.path.startsWith('/islands/') && !args.path.startsWith('./')) return undefined;
          if (args.namespace !== 'pinned-island' && !args.importer.endsWith('offline-compiled-entry.js')) return undefined;
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
          if (options.offline && absolute === bootUrl) {
            return { path: path.join(process.cwd(), 'lib/offline/compiled-boot.ts') };
          }
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
