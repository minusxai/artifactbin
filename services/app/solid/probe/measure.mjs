/**
 * Measure a probe build (vite.probe.mts): per output chunk, raw / gzip / brotli bytes — gzip level 9
 * and brotli quality 11 text mode, the settings scripts/lib/precompress.mjs serves in production —
 * and what the chunk holds, by category (rolldown renderedLength: tree-shaken, pre-minify).
 *
 *   node services/app/solid/probe/measure.mjs <outDir> [--json]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { category } from './category.mjs';

const outDir = process.argv[2];
const asJson = process.argv.includes('--json');
const map = JSON.parse(readFileSync(path.join(outDir, 'module-map.json'), 'utf8'));

const sizes = (file) => {
  const source = readFileSync(path.join(outDir, file));
  return {
    raw: source.byteLength,
    gzip: zlib.gzipSync(source, { level: 9 }).byteLength,
    brotli: zlib.brotliCompressSync(source, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength } }).byteLength,
  };
};

const byFile = new Map(map.map((chunk) => [chunk.file, chunk]));
const rows = map.map((chunk) => {
  const cats = {};
  for (const m of chunk.modules) cats[category(m.id)] = (cats[category(m.id)] ?? 0) + m.rendered;
  const top = [...chunk.modules].sort((a, b) => b.rendered - a.rendered).slice(0, 6).map((m) => `${m.id.replace(/^node_modules\//, 'nm/')}:${m.rendered}`);
  return { file: chunk.file, kind: chunk.isEntry ? 'entry' : chunk.isDynamicEntry ? 'lazy' : 'shared', ...sizes(chunk.file), cats, top, imports: chunk.imports, dynamicImports: chunk.dynamicImports };
});

/** Every chunk a route needs: the entry's static closure plus the route chunk's static closure. */
const closure = (files) => {
  const seen = new Set(); const stack = [...files];
  while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); stack.push(...(byFile.get(f)?.imports ?? [])); }
  return seen;
};
const entry = map.find((c) => c.isEntry).file;
const routeFile = (name) => map.find((c) => c.isDynamicEntry && c.modules.some((m) => new RegExp(`pages/${name}\\.tsx$`).test(m.id)))?.file;
const total = (files) => rows.filter((r) => files.has(r.file)).reduce((sum, r) => ({ raw: sum.raw + r.raw, gzip: sum.gzip + r.gzip, brotli: sum.brotli + r.brotli, chunks: sum.chunks + 1 }), { raw: 0, gzip: 0, brotli: 0, chunks: 0 });
const shell = closure([entry]);
const routes = ['Trash', 'NotFound', 'Login', 'Start', 'Welcome', 'Notifications', 'Account', 'Docs', 'Profile'];
const routeTotals = Object.fromEntries(routes.map(name => {
  const file = routeFile(name);
  const files = file ? closure([entry, file]) : new Set();
  return [name, { ...total(files), increment: total(new Set([...files].filter(f => !shell.has(f)))) }];
}));
const result = { outDir, rows, totals: { shellOnly: total(shell), routes: routeTotals } };

if (asJson) console.log(JSON.stringify(result, null, 1));
else {
  console.log(`# ${outDir}`);
  console.log('file | kind | raw | gzip | brotli | pre-minify bytes by category');
  for (const r of rows) console.log(`${r.file} | ${r.kind} | ${r.raw} | ${r.gzip} | ${r.brotli} | ${Object.entries(r.cats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`TOTAL shellOnly: ${result.totals.shellOnly.chunks} chunks, raw ${result.totals.shellOnly.raw}, gzip ${result.totals.shellOnly.gzip}, brotli ${result.totals.shellOnly.brotli}`);
  for (const [name, t] of Object.entries(routeTotals)) console.log(`TOTAL ${name}: ${t.chunks} chunks, raw ${t.raw}, gzip ${t.gzip}, brotli ${t.brotli}; incremental brotli ${t.increment.brotli}`);
  for (const r of rows) console.log(`  top ${r.file}: ${r.top.join(', ')}`);
}
