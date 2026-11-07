/** Command: a page computed from a CSV (examples/csv-dashboard.html) set up in one call. */
export const DESCRIPTION = `Set up a page computed from a CSV in one call: a dashboard, report or
chart page. Copies the CSV into the project and publishes it as a dataset; copies
examples/csv-dashboard.html as index.html and its steps file as steps.mjs; links the dataset and
writes a DATA block that reads this CSV's columns (labels, a stat per number column, a chart per
number column by the first text column), with [bracketed] text for you to write.
Usage: node scripts/new-page.mjs --data FILE.csv --title NAME [--artifact ID] [--dir DIR]
Flags: --data FILE.csv the rows (a header line, then one row per line); --title NAME the page's
  name, for <title>; --artifact ID an existing page this one replaces (a rebuild: the printed
  publish command publishes over it); --dir DIR the project directory (default: the current one;
  created when missing). Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/new-page.mjs --data sales.csv --title "Revenue by region"
  node scripts/new-page.mjs --data coffee.csv --title "Coffee at a small startup" --artifact Ab12Cd
Gotchas: a rerun is safe: existing files are kept, never overwritten, and the dataset its
  companion (FILE.csv.af.json) records is reused. The output names what DATA draws and how to
  change it with your columns; steps.mjs needs no edits.
Exit: 0 ok; 1 failed; 2 invalid (the one next step is printed); 3 auth/access (sign in, then
  rerun); 5 unknown write outcome (the error names the journal for publish.mjs --resume).
  Results never contain credentials.`;

import path from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {runTool,ToolError,selectedServer,serverOrigin,optionalFile} from './toolbox-client.mjs';
import {publishCommand} from './toolbox-publish.mjs';
import {dataBaseline} from './toolbox-publish-guard.mjs';

const EXAMPLES = new URL('../examples/', import.meta.url);
const USAGE = 'node scripts/new-page.mjs --data FILE.csv --title NAME';
const resolve = (base, file) => path.resolve(base, String(file).replace(/^~(?=$|[\\/])/,
  homedir()));
const htmlText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quote = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const label = column => {
  const words = column.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const nameOf = file => {
  const name = path.basename(file).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g,
    '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(name) ? name.slice(0, 40) : 'rows';
};

function parse(text) {
  const cells = line => [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].slice(0, -1)
    .map(m => m[1].replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  return {columns: cells(lines[0] ?? ''), rows: lines.slice(1).map(cells)};
}
async function create(file, bytes) {
  try { await writeFile(file, bytes, {flag: 'wx'}); return true; } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
/** The DATA block for these columns: every text a [bracketed] draft computed from the rows. */
function dataBlock(name, columns, numbers) {
  const x = columns.find(column => !numbers.includes(column)) ?? columns[0];
  const shown = numbers.slice(0, 3), first = numbers[0];
  const stat = col => `    {id:${quote(col)}, ` +
    `label:${quote(`[Total ${label(col).toLowerCase()}]`)}, ` +
    `value: h => h.fmt(h.sum(${quote(col)}))},`;
  const chart = col => `    {id:${quote(col)}, title:${quote(`[${label(col)} by ${x}]`)}, ` +
    `mark:'bar', x:${quote(x)}, y:${quote(col)}},`;
  const lead = first ? `\`[\${h.fmt(h.sum(${quote(first)}))} ` +
    `${label(first).toLowerCase()} across \${h.count()} rows.]\`` : '`[${h.count()} rows.]`';
  return ['window.DATA = {',
    `  dataset: ${quote(name)}, order: ${quote(x)},`,
    `  labels: {${columns.map(col => `${col}:${quote(label(col))}`).join(', ')}},`,
    "  kicker: '[Kicker]',",
    `  lead: h => ${lead},`,
    '  stats: [', ...shown.map(stat), '  ],',
    '  charts: [', ...shown.slice(0, 2).map(chart), '  ],',
    '  sections: [',
    "    {id:'reading', title:'[How to read this]', text: h => `[What the reader should take " +
      "from these ${h.count()} rows.]`},",
    '  ],', '};'].join('\n');
}
/** The starter with this CSV's dataset, DATA block and title in place of the sample's. */
function fill(starter, {title, id, name, columns, numbers}) {
  const start = starter.indexOf('window.DATA = {'), end = starter.indexOf('\n};', start) + 3;
  const sample = /data-af-name="(\w+)"/.exec(starter)?.[1];
  return (starter.slice(0, start) + dataBlock(name, columns, numbers) + starter.slice(end))
    .replace(`data-af-name="${sample}" href="ref:DATASET_ID"`, `data-af-name="${name}" ` +
      `href="ref:${id}"`)
    .replace(/<title>\[[^\]<]+\]<\/title>/, `<title>${htmlText(title)}</title>`);
}
/** What the written DATA shows, in this CSV's names: what the agent keeps or changes. */
function draws(columns, numbers, rows) {
  const x = columns.find(column => !numbers.includes(column)) ?? columns[0];
  return `DATA draws a lead, a total per number column (${numbers.slice(0, 3).join(', ') ||
    'none'}), and a bar chart of ${numbers.slice(0, 2).map(y => `${y} summed per ${x}`)
    .join(' and ') || 'nothing'}, each with a table of its values (${rows.length} rows).`;
}
/** The usual changes, written with this CSV's own columns and a real value. */
function variations(columns, numbers, rows) {
  const x = columns.find(column => !numbers.includes(column)) ?? columns[0];
  const other = columns.find(column => column !== x && !numbers.includes(column));
  const y = numbers[0] ?? columns[1] ?? x, at = col => rows[0]?.[columns.indexOf(col)] ?? '';
  return [`one line: mark:'line'`, other && `a line or bar per ${other}: series:'${other}'`,
    other && `only some rows: where:{${other}:'${at(other)}'}`,
    `one value per ${x} as given: aggregate:'last'`, 'no value table: table:false',
    'no stats or sections: stats:[], sections:[]',
    `a number for one ${x} in a text: h.where({${x}:'${at(x)}'}).sum('${y}')`]
    .filter(Boolean).join('; ');
}
export async function newPageCommand({values, positionals}, options = {}) {
  const title = String(values.title ?? positionals.join(' ')).trim()
    .replace(/^\[(.*)\]$/, '$1').trim();
  if (!title) throw new ToolError('missing_title', 'The page needs a name.', 2, 'Run ' + USAGE);
  if (values.data === undefined) throw new ToolError('missing_data', 'The page needs its rows.',
    2, 'Pass the CSV: ' + USAGE);
  const base = options.cwd ?? process.cwd(), dir = resolve(base, values.dir ?? '.');
  const server = serverOrigin(selectedServer(values, options.env));
  const source = resolve(base, values.data), file = path.basename(source);
  const csv = await readFile(source, 'utf8').catch(error => {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    throw new ToolError('data_not_found', `No CSV file at ${values.data}.`, 2,
      `Pass the CSV's path: ${USAGE}`);
  });
  const {columns, rows} = parse(csv);
  if (!rows.length) throw new ToolError('data_empty', `${values.data} has no data rows.`, 2,
    'Pass a CSV with a header line and at least one row.');
  const numbers = columns.filter((_, i) => rows.every(row => row[i] === '' ||
    Number.isFinite(Number(row[i]))) && rows.some(row => row[i] !== ''));
  await mkdir(dir, {recursive: true});
  const at = name => path.join(dir, name), created = [], kept = [];
  const companion = await optionalFile(at(file) + '.af.json');
  const name = nameOf(file);
  const dataset = companion ? {id: dataBaseline(companion, at(file), server).id, reused: true}
    : null;
  const starter = await readFile(new URL('csv-dashboard.html', EXAMPLES), 'utf8');
  const steps = await readFile(new URL('csv-dashboard-steps.mjs', EXAMPLES));
  const copied = path.resolve(at(file)) === source || await create(at(file), csv);
  const published = dataset ?? {id: (await publishCommand({values: {server, title:
    `${title} data`, name}, positionals: [at(file)]}, options)).id, reused: false};
  for (const [file2, bytes] of [['index.html', fill(starter, {title, id: published.id, name,
    columns, numbers})], ['steps.mjs', steps]]) {
    (await create(at(file2), bytes) ? created : kept).push(file2);
  }
  (copied === true && !companion ? created : kept).push(file);
  const publish = 'node scripts/publish.mjs index.html' +
    (values.artifact ? ` --artifact ${values.artifact}` : '');
  return {project: dir, title, created, kept,
    dataset: {id: published.id, name, rows: rows.length, columns, numbers,
      reused: published.reused},
    note: `${name} ${published.id} (${rows.length} rows${published.reused ? ', reused' : ''}); ` +
      `index.html links it as ${name} and is titled ${JSON.stringify(title)}.`,
    draws: draws(columns, numbers, rows), next: 'Next: in index.html edit only DATA (its ' +
      '[bracketed] text, and the stats, charts and sections the request needs); it can do the ' +
      `layout asked for: ${variations(columns, numbers, rows)}; then ${publish} && ` +
      'node scripts/check.mjs index.html --steps steps.mjs'};
}
await runTool('new-page', import.meta.url, newPageCommand);
