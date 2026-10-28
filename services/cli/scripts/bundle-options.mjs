/**
 * THE CLI BUNDLE'S esbuild OPTIONS — one definition for `scripts/build.mjs` and for the test that runs
 * the bundle with nothing beside it (test/bundle-self-contained.test.ts), so what is tested is what ships.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * THE SQLITE WASM, EMBEDDED. The engine reads `sqlite3.wasm` from beside its own module, which a
 * bundle copied on its own (a local not-installed eval leg serves `afbin.mjs` as the platform binary)
 * or a single executable does not have. So every build carries the bytes: `src/sqlite-wasm-embedded.ts`
 * is replaced by the file's contents, and `src/sqlite-wasm.ts` hands them to the engine. From source
 * that module stays empty and the package reads its own file.
 *
 * @type {import('esbuild').Plugin}
 */
const embedSqliteWasm = {
  name: 'embed-sqlite-wasm',
  setup(b) {
    const wasm = require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm');
    b.onLoad({ filter: /src[\\/]sqlite-wasm-embedded\.ts$/ }, () => ({
      contents: `import wasm from ${JSON.stringify(wasm)};export const embeddedSqliteWasm=wasm;`,
      loader: 'js',
    }));
    b.onLoad({ filter: /[\\/]sqlite3\.wasm$/ }, async (args) => ({ contents: await readFile(args.path), loader: 'binary' }));
  },
};

/**
 * The ESM bundle `dist/afbin.mjs` (and the library entry) is built with: everything but node-pty inside it.
 *
 * @param {Record<string, string>} entryPoints
 * @returns {import('esbuild').BuildOptions}
 */
export function cliBundle(entryPoints) {
  return {
    entryPoints,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // node-pty is native and prepared per platform at install (scripts/prepare-pty.mjs).
    external: ['node-pty'],
    banner: { js: "#!/usr/bin/env node\nimport {createRequire as __afbinCreateRequire} from 'node:module'; const require=__afbinCreateRequire(import.meta.url);" },
    plugins: [embedSqliteWasm],
  };
}
