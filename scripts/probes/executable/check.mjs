import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';

const run = promisify(execFile);
const output = resolve('node_modules/.cache/executable-proof');
const home = await mkdtemp(join(tmpdir(), 'afbin-packaged-proof-'));
const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
let requests = 0, corrupt = true;
const server = createServer(async (request, response) => {
  requests++;
  const file = manifest.downloads.find(file => request.url === '/' + file.key);
  if (!file) { response.writeHead(404); response.end(); return; }
  response.end(corrupt ? Buffer.from('corrupt') : await readFile(join(output, 'payloads', file.key)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const binary = join(home, 'afbin-proof');
  await copyFile(join(output, 'afbin-proof'), binary);
  const emptyPath = join(home, 'empty-path');
  await mkdir(emptyPath);
  const env = {HOME: home, PATH: emptyPath, TMPDIR: home, TMP: home, TEMP: home};
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const invoke = (mode, cache = join(home, 'cache'), url = endpoint) => run(binary,
    [mode, cache, url], {cwd: home, env, timeout: 120000, maxBuffer: 1048576});
  assert.deepEqual(JSON.parse((await invoke('idle')).stdout), {ready: true});
  assert.equal(requests, 0, 'idle must not download');
  assert.ok(!(await readdir(home)).includes('cache'), 'idle must not extract drivers');

  // Negative control: removing the lazy-install step must break real execution.
  await assert.rejects(invoke('without-install', join(home, 'negative')),
    error => /MODULE_NOT_FOUND|Cannot find module/.test(error.stderr));
  assert.equal(requests, 0);
  await assert.rejects(invoke('work'), error => /checksum/.test(error.stderr));
  assert.equal(requests, 1, 'corrupt native download must fail before executing');
  corrupt = false;
  const first = await Promise.all([invoke('work'), invoke('work')]);
  for (const result of first) {
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.rows, [{total: 5}]);
    assert.equal(report.text, 'Total: 5');
    assert.ok(report.pngBytes > 1000);
    assert.equal(report.sea, true);
  }
  const beforeOffline = requests;
  await new Promise(resolve => server.close(resolve));
  const offline = JSON.parse((await invoke('work')).stdout);
  assert.deepEqual(offline.rows, [{total: 5}]);
  assert.equal(requests, beforeOffline);
  await copyFile(join(home, 'cache', 'result.png'), join(output, 'result.png'));

  // Cache corruption must be detected, even when the installer cannot repair it offline.
  const duckdb = manifest.downloads.find(file => file.path.endsWith('duckdb.node'));
  await writeFile(join(home, 'cache', 'sql', duckdb.path), 'damaged');
  await assert.rejects(invoke('work'), error => /fetch failed/.test(error.stderr));
  await new Promise(resolve => server.listen(Number(new URL(endpoint).port), '127.0.0.1', resolve));
  assert.deepEqual(JSON.parse((await invoke('work')).stdout).rows, [{total: 5}]);
  const evidence = {status: 'passed', platform: process.platform, arch: process.arch,
    versions: manifest.versions, embeddedDriverBytes: manifest.driverBytes,
    nativeDownloadBytes: manifest.downloads.reduce((n, file) => n + file.size, 0),
    checks: ['real SEA', 'no external Node/npm', 'idle without download or extraction',
      'negative control fails without native install', 'corrupt download rejected',
      'concurrent first use', 'DuckDB SQL', 'Chromium DOM and PNG',
      'offline reuse', 'damaged cache rejected offline and repaired online'],
    output: offline};
  await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  server.closeAllConnections(); server.close();
  await rm(home, {recursive: true, force: true});
}
