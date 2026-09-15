import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFile, fork} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';

// CI-only packaging boundary: build tools use the checkout; consumers receive only npm tarballs.
const run = promisify(execFile), repository = process.cwd();
const output = resolve('node_modules/.cache/package-proof');
const isolated = await mkdtemp(join(tmpdir(), 'afbin-package-proof-'));
const version = '0.0.0-probe';
await mkdir(output, {recursive: true});
const install = (cwd, files) => run('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', ...files], {cwd, timeout: 180000, maxBuffer: 1048576});
async function pack(cwd) {
  const result = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {cwd, timeout: 30000});
  return join(output, JSON.parse(result.stdout)[0].filename);
}
async function compiled(name, entries, exports, dependencies = {}) {
  const directory = join(output, name.split('/')[1]);
  await mkdir(directory, {recursive: true});
  const result = await build({entryPoints: entries, outdir: join(directory, 'dist'), outExtension: {'.js': '.mjs'},
    bundle: true, platform: 'node', format: 'esm', target: 'node22', metafile: true,
    external: ['@artifactbin/contracts', '@duckdb/node-api']});
  await writeFile(join(directory, 'package.json'), JSON.stringify({name, version, type: 'module', exports, files: ['dist'], dependencies}));
  return {file: await pack(directory), inputs: Object.keys(result.metafile.inputs)};
}
let child;
try {
  // Negative control: today's workspace-only TS exports are not standalone Node package exports.
  const raw = await pack(join(repository, 'services/contracts'));
  const negative = join(isolated, 'raw-consumer'); await mkdir(negative);
  await install(negative, [raw]);
  await assert.rejects(run(process.execPath, ['--input-type=module', '-e', "await import('@artifactbin/contracts')"], {cwd: negative}),
    error => /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/.test(error.stderr));

  const contracts = await compiled('@artifactbin/contracts', {index: 'services/contracts/src/index.ts'}, {'.': './dist/index.mjs'});
  const client = await compiled('@artifactbin/proof-client', {index: 'services/utils/src/clients.ts'}, {'.': './dist/index.mjs'}, {'@artifactbin/contracts': version});
  assert.ok(client.inputs.every(path => !/@duckdb|playwright|sharp/.test(path)));
  const duckdbVersion = JSON.parse(await readFile('node_modules/@duckdb/node-api/package.json', 'utf8')).version;
  const sql = await compiled('@artifactbin/proof-sql', {index: 'services/sql/src/index.ts', local: 'services/sql/src/local.ts'},
    {'.': './dist/index.mjs', './local': './dist/local.mjs'}, {'@artifactbin/contracts': version, '@duckdb/node-api': duckdbVersion});
  const app = join(isolated, 'production-app'), engine = join(isolated, 'sql-service');
  await mkdir(app); await mkdir(engine);
  await install(app, [contracts.file, client.file]);
  await install(engine, [contracts.file, sql.file]);
  for (const name of ['@duckdb', 'playwright', 'playwright-core', 'sharp']) {
    await assert.rejects(access(join(app, 'node_modules', name)), {code: 'ENOENT'});
  }
  for (const cwd of [app, engine]) await copyFile('scripts/probes/packages/conformance.mjs', join(cwd, 'conformance.mjs'));
  await copyFile('scripts/probes/packages/service.mjs', join(engine, 'service.mjs'));
  await copyFile('scripts/probes/packages/consumer.mjs', join(app, 'consumer.mjs'));
  // No inherited tsx loader, NODE_PATH or checkout cwd can rescue missing package files.
  const env = {PATH: process.env.PATH, HOME: isolated, TMPDIR: isolated};
  child = fork(join(engine, 'service.mjs'), {cwd: engine, env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('SQL service did not start: ' + stderr)), 30000);
    child.once('message', message => { clearTimeout(timer); resolve(message); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('SQL service exited ' + code + ': ' + stderr)); });
  });
  const consumed = await run(process.execPath, ['consumer.mjs', ready.url], {cwd: app, env, timeout: 30000});
  const remote = JSON.parse(consumed.stdout);
  assert.deepEqual(remote.checks, ready.checks);
  const evidence = {status: 'passed', node: process.version,
    rawTypeScriptPackage: 'rejected by plain Node; compiled exports required',
    packageTransport: 'npm pack tarballs installed into separate directories outside checkout',
    localChecks: ready.checks, remote, productionAppNativeDependencies: 'absent',
    scope: 'Real contracts, service clients and SQL implementation; not a full CLI/server repository extraction or declaration-package validation'};
  await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (child && child.exitCode === null) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); });
  }
  await rm(isolated, {recursive: true, force: true});
}
