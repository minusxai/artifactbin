// CI probe environment boundary: inputs are argv; no production config is read.
const {getAsset, isSea} = require('node:sea');
const fs = require('node:fs/promises');
const {join, dirname} = require('node:path');
const {createRequire} = require('node:module');
const {compileFunction} = require('node:vm');
const {createHash} = require('node:crypto');
const {gunzipSync} = require('node:zlib');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {createWriteStream} = require('node:fs');
const {DatabaseSync} = require('node:sqlite');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [mode, root, endpoint] = process.argv.slice(2);
const manifest = JSON.parse(getAsset('manifest', 'utf8'));

async function publish(staging, target) {
  try { await fs.rename(staging, target); }
  catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
    await fs.rm(staging, {recursive: true, force: true});
  }
}
async function valid(target, files) {
  try {
    for (const file of files) {
      if (file.link) {
        if (await fs.readlink(join(target, file.path)) !== file.link) return false;
      } else if (hash(await fs.readFile(join(target, file.path))) !== file.sha256) return false;
    }
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function install(group) {
  const files = manifest[group], target = join(root, group);
  if (await valid(target, files)) return target;
  await fs.rm(target, {recursive: true, force: true});
  const staging = await fs.mkdtemp(join(root, group + '-stage-'));
  try {
    for (const file of files) {
      const path = join(staging, file.path);
      await fs.mkdir(dirname(path), {recursive: true, mode: 0o700});
      if (file.link) { await fs.symlink(file.link, path); continue; }
      const response = await fetch(endpoint + '/' + file.key, {signal: AbortSignal.timeout(30000)});
      if (!response.ok || !response.body) throw Error('Download failed: ' + response.status);
      let bytes = 0;
      const digest = createHash('sha256');
      const verify = new Transform({transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > file.size) { callback(Error('checksum: oversized payload')); return; }
        digest.update(chunk); callback(null, chunk);
      }});
      await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(path, {mode: file.mode}));
      if (bytes !== file.size || digest.digest('hex') !== file.sha256) throw Error('checksum mismatch');
    }
    await publish(staging, target);
    if (!await valid(target, files)) throw Error('Installed cache verification failed');
    return target;
  } finally { await fs.rm(staging, {recursive: true, force: true}); }
}
async function drivers() {
  const target = join(root, 'drivers');
  try { await fs.access(join(target, 'playwright-core/package.json')); return target; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = JSON.parse(gunzipSync(Buffer.from(getAsset('drivers'))));
  const staging = await fs.mkdtemp(join(root, 'drivers-stage-'));
  try {
    for (const [name, file] of Object.entries(files)) {
      const path = join(staging, name);
      await fs.mkdir(dirname(path), {recursive: true, mode: 0o700});
      await fs.writeFile(path, Buffer.from(file.data, 'base64'), {mode: file.mode});
    }
    await publish(staging, target);
    return target;
  } finally { await fs.rm(staging, {recursive: true, force: true}); }
}
async function main() {
  if (mode === 'idle') { console.log(JSON.stringify({ready: true})); return; }
  await fs.mkdir(root, {recursive: true, mode: 0o700});
  if (mode === 'storage') {
    const driverRoot = await drivers();
    const {PGlite} = createRequire(join(root, 'loader.cjs'))(join(driverRoot, 'pglite'));
    const db = new PGlite(join(root, 'pglite'));
    const client = new DatabaseSync(join(root, 'state.sqlite'));
    try {
      await db.exec('create table if not exists probe (id integer primary key, runs integer)');
      const {rows} = await db.query('insert into probe values (1, 1) on conflict (id) do update set runs = probe.runs + 1 returning runs');
      client.exec('create table if not exists probe (id integer primary key, runs integer)');
      const local = client.prepare('insert into probe values (1, 1) on conflict (id) do update set runs = probe.runs + 1 returning runs').get();
      console.log(JSON.stringify({pgliteRuns: rows[0].runs, sqliteRuns: local.runs}));
    } finally { client.close(); await db.close(); }
    return;
  }
  const sql = mode === 'without-install' ? join(root, 'missing') : await install('sql');
  const nativeRequire = createRequire(join(root, 'loader.cjs'));
  // Intentional engine boundary: evaluate the embedded JS only after native installation.
  const duckdbModule = {exports: {}};
  compileFunction(getAsset('duckdb', 'utf8'), ['require', 'module', 'exports'])(
    spec => spec === '@duckdb/node-bindings' ? nativeRequire(join(sql, 'duckdb.node')) : nativeRequire(spec),
    duckdbModule, duckdbModule.exports);
  const instance = await duckdbModule.exports.DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  let browser;
  try {
    const rows = (await connection.runAndReadAll('select sum(v)::INTEGER as total from (values (2), (3)) t(v)')).getRowObjects();
    const chromiumRoot = await install('chromium');
    const driverRoot = await drivers();
    // Playwright expects filesystem-relative support assets; these came from the SEA, not a download.
    const {chromium} = nativeRequire(join(driverRoot, 'playwright-core'));
    browser = await chromium.launch({headless: true, executablePath: join(chromiumRoot, manifest.chromiumExecutable)});
    const page = await browser.newPage({viewport: {width: 480, height: 240}});
    await page.setContent('<html><body><h1 id="result">Total: ' + rows[0].total + '</h1></body></html>');
    const text = await page.locator('#result').innerText();
    const png = await page.screenshot({path: join(root, 'result.png')});
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid PNG');
    console.log(JSON.stringify({sea: isSea(), node: process.version, rows, text, pngBytes: png.length}));
  } finally {
    await browser?.close(); connection.closeSync(); instance.closeSync();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
