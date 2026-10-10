/** Compile a declared Lambda script over the SAME page bindings as a browser artifact.
 * Author code is never evaluated here. Its only modules are page and pure Solid reactivity;
 * no CDN imports, DOM helpers, filesystem or credentials enter the program.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type * as Esbuild from 'esbuild';
import { transformAsync, type PluginObj } from '@babel/core';
import { buildAuthorModule, type AuthorModuleNames } from './author-module.server';
import type { CompiledDataflow } from '@/lib/dataflow';

const SOLID = ['batch', 'createEffect', 'createMemo', 'createRoot', 'createSignal', 'on', 'onCleanup', 'onMount', 'untrack'];
let runtime: Promise<string> | undefined;
async function runtimeSource(build: typeof Esbuild.build): Promise<string> {
  try { return await readFile(new URL('lambda-page-runtime.js', import.meta.url), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Source/dev only. Production build-server emits the asset beside its bundle.
    const output = await build({
      entryPoints: [fileURLToPath(new URL('../runner/runtime.ts', import.meta.url))], bundle: true, write: false,
      platform: 'browser', conditions: ['browser'], format: 'iife', globalName: 'LambdaPageRuntime',
      target: 'es2022', minify: true, logLevel: 'silent',
    });
    return output.outputFiles[0]!.text;
  }
}

export async function buildLambdaModule(script: string, flow: CompiledDataflow, names?: AuthorModuleNames): Promise<string> {
  // Intentional lazy compiler import, identical to browser author-module: jsdom realm checks must not run at import.
  const { build, transform } = await import('esbuild');
  const plain = (await transform(script, { loader: 'ts', target: 'es2022', format: 'esm' })).code;
  // esbuild deliberately leaves nonliteral import() calls untouched. Refuse them here rather
  // than allowing a program to escape the fixed module graph or fail later inside the isolate.
  await transformAsync(plain, { babelrc: false, configFile: false, sourceType: 'module',
    plugins: [(): PluginObj => ({ visitor: { CallExpression(path) {
      if (path.node.callee.type === 'Import' || (path.node.callee.type === 'Identifier' && path.node.callee.name === 'require' && !path.scope.getBinding('require'))) {
        throw path.buildCodeFrameError('Lambda dynamic module loading is not allowed; use static imports from page or solid-js');
      }
    } } })],
  });
  const checked = await buildAuthorModule(plain, names ?? {
    values: flow.values.filter((v) => v.kind === 'scalar' && v.type !== 'table').map((v) => v.name),
    tables: flow.values.filter((v) => v.kind === 'table' || v.type === 'table').map((v) => v.name),
    queries: flow.queries.map((q) => q.name), mutations: flow.mutations.map((m) => m.name),
  });
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  if (!checked.module.exports.includes('default')) throw new Error('A Lambda script must default-export its run function');
  const author = await build({
    stdin: { contents: plain, loader: 'js', sourcefile: 'lambda-script.ts' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'LambdaAuthor', target: 'es2022', minify: true, logLevel: 'silent',
    plugins: [{ name: 'headless-page', setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === 'page' || args.path === 'solid-js') return { path: args.path, namespace: 'lambda-binding' };
        return { errors: [{ text: `Lambda headless import not allowed: ${args.path}; use page or solid-js` }] };
      });
      b.onLoad({ filter: /.*/, namespace: 'lambda-binding' }, ({ path }) => ({
        contents: path === 'page'
          ? ['signal', 'query', 'mutation'].map((name) => `export const ${name} = (ref) => __lambdaPage.bindings.${name}(ref);`).join('\n')
          : SOLID.map((name) => `export const ${name} = LambdaPageRuntime.${name};`).join('\n'), loader: 'js',
      }));
    } }],
  });
  const headless = await (runtime ??= runtimeSource(build).catch((error) => { runtime = undefined; throw error; }));
  return `${headless}\nexport default async function(input, context) {
    const __lambdaPage = LambdaPageRuntime.createLambdaPage(${JSON.stringify(flow)}, context);
    try {
      __lambdaPage.start();
      const run = __lambdaPage.evaluate(() => { ${author.outputFiles[0]!.text}; return LambdaAuthor.default; });
      if (typeof run !== 'function') throw new Error('Lambda default export must be a function');
      const output = await run(input, context);
      await __lambdaPage.drain();
      return output;
    } finally { __lambdaPage.dispose(); }
  }\n`;
}
