import {readFile, writeFile, mkdir, readdir, copyFile, chmod, stat, readlink, rm} from 'node:fs/promises';
import {join, dirname, relative, resolve, sep} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {inject} from 'postject';
import {chromium} from 'playwright-core';
import {provisionRuntime} from '../../../services/cli/scripts/runtime.mjs';
import {injectNative} from '../../../services/cli/scripts/inject-native.mjs';

// Build-only environment boundary: Playwright's CI install cache locates native input files.
const require = createRequire(import.meta.url);
const output = resolve('node_modules/.cache/executable-proof');
await rm(output, {recursive: true, force: true});
await mkdir(join(output, 'payloads'), {recursive: true});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = {sql: [], chromium: [], downloads: [], versions: {
  duckdb: require('@duckdb/node-api/package.json').version,
  playwright: require('playwright-core/package.json').version,
}};
async function collect(root, prefix, visit) {
  for (const entry of await readdir(join(root, prefix), {withFileTypes: true})) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) await collect(root, path, visit);
    else await visit(path, entry.isSymbolicLink());
  }
}
async function payload(group, root, path, link) {
  if (link) {
    const target = await readlink(join(root, path));
    const resolved = relative(root, resolve(root, dirname(path), target));
    if (resolved.startsWith('..') || target.startsWith('/')) throw Error('External payload symlink');
    manifest[group].push({path, link: target}); return;
  }
  const source = join(root, path), bytes = await readFile(source);
  const key = String(manifest.downloads.length);
  const file = {path, key, sha256: sha256(bytes), size: bytes.length, mode: (await stat(source)).mode & 0o777};
  await copyFile(source, join(output, 'payloads', key));
  manifest[group].push(file); manifest.downloads.push(file);
}
const sqlRoot = dirname(require.resolve(`@duckdb/node-bindings-${process.platform}-${process.arch}/package.json`));
await collect(sqlRoot, '', async (path, link) => {
  if (/\.(node|dylib|so|dll)$/.test(path)) await payload('sql', sqlRoot, path, link);
});
if (!manifest.sql.some(file => file.path === 'duckdb.node')) throw Error('Missing native DuckDB binding');
const browserCache = resolve(process.env.PLAYWRIGHT_BROWSERS_PATH);
const executable = chromium.executablePath();
const distribution = relative(browserCache, executable).split(sep)[0];
if (!distribution || distribution.startsWith('..')) throw Error('Browser outside CI cache');
const chromiumRoot = join(browserCache, distribution);
manifest.chromiumExecutable = relative(chromiumRoot, executable);
await collect(chromiumRoot, '', (path, link) => payload('chromium', chromiumRoot, path, link));

const driverRoot = dirname(require.resolve('playwright-core/package.json'));
const files = {};
await collect(driverRoot, '', async (path, link) => {
  if (link) throw Error('Unexpected driver symlink');
  if (/\.(node|dylib|so|dll)$/.test(path)) throw Error('Native binary in driver payload');
  const source = join(driverRoot, path);
  files[join('playwright-core', path)] = {data: (await readFile(source)).toString('base64'), mode: (await stat(source)).mode & 0o777};
});
const drivers = gzipSync(JSON.stringify(files));
manifest.driverBytes = drivers.length;
await writeFile(join(output, 'drivers.gz'), drivers);
await build({entryPoints: [require.resolve('@duckdb/node-api')], outfile: join(output, 'duckdb.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['@duckdb/node-bindings']});
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
const runtime = await provisionRuntime();
manifest.versions.node = execFileSync(runtime, ['--version'], {encoding: 'utf8'}).trim();
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
const config = join(output, 'sea.json'), blob = join(output, 'sea.blob');
await writeFile(config, JSON.stringify({main: resolve('scripts/probes/executable/entry.cjs'), output: blob,
  disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false,
  assets: {drivers: join(output, 'drivers.gz'), duckdb: join(output, 'duckdb.cjs'), manifest: join(output, 'manifest.json')}}));
execFileSync(runtime, ['--experimental-sea-config', config], {stdio: 'inherit'});
const binary = join(output, 'afbin-proof');
await copyFile(runtime, binary); await chmod(binary, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary]);
if (process.platform === 'linux' || process.arch === 'x64') injectNative(binary, blob);
else await inject(binary, 'NODE_SEA_BLOB', await readFile(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', machoSegmentName: 'NODE_SEA'});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary]);
console.log(JSON.stringify({binaryBytes: (await stat(binary)).size, drivers: drivers.length,
  nativeFiles: manifest.downloads.length, versions: manifest.versions}));
