/** Command: a page computed from a CSV (examples/csv-dashboard.html) set up in one call. */
export const DESCRIPTION = `Set up a page computed from a CSV in one call: a dashboard, report or
chart page. Copies the CSV into the project as NAME.csv; copies examples/csv-dashboard.html as
index.html, its renderer csv-dashboard.mjs and its steps file as steps.mjs; links the CSV by its
path (the page's first publish creates the NAME dataset from it, and a publish after the CSV
changes updates that dataset) and writes a DATA block whose SQL queries read this CSV's columns
(labels, a total per number column, a chart per number column by the first text column), with
[bracketed] text for you to write. Nothing is sent to the server.
Usage: node scripts/new-page.mjs --data FILE.csv --title NAME [--artifact ID] [--dir DIR]
Flags: --data FILE.csv the rows (a header line, then one row per line); --title NAME the page's
  name, for <title>; --artifact ID an existing page this one replaces (a rebuild: the printed
  publish command publishes over it); --dir DIR the project directory (default: the current one;
  created when missing). Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/new-page.mjs --data sales.csv --title "Revenue by region"
  node scripts/new-page.mjs --data coffee.csv --title "Coffee at a small startup" --artifact Ab12Cd
Gotchas: a rerun is safe: the page, renderer and steps file are kept, never overwritten; only
  the CSV copy takes the rows passed (updated), which the next publish sends over the same
  dataset. NAME is the file's name made a table name (Q1 sales.csv → q1_sales). The output
  names what DATA draws and how to change it with your columns; steps.mjs needs no edits.
Exit: 0 ok; 1 failed; 2 invalid (the one next step is printed). Results never contain
  credentials.`;

import path from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {runTool,ToolError,optionalFile} from './toolbox-client.mjs';
import {publishStep} from './toolbox-source.mjs';

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
/** A column in SQL: bare when it is a plain name, else double-quoted. */
const sqlName = column => /^[a-z_][a-z0-9_]*$/i.test(column) ? column :
  `"${column.replace(/"/g, '""')}"`;
/** Coordinates are numbers but neither summed nor charted as one: a map variation names them. */
const COORDINATE = /^(lat(itude)?|lon|lng|long|longitude)$/i;
/** The text columns, in order: the first is what DATA groups by. */
const texts = (columns, numbers) => columns.filter(column => !numbers.includes(column) &&
  !COORDINATE.test(column));
/** The DATA block for these columns: SQL queries, every text a [bracketed] draft. */
function dataBlock(name, columns, numbers) {
  const x = texts(columns, numbers)[0] ?? columns[0];
  const shown = numbers.slice(0, 3), first = numbers[0], by = `by_${x.replace(/\W+/g, '_')}`;
  const sums = cols => cols.map(col => `sum(${sqlName(col)}) as ${sqlName(col)}`).join(', ');
  const totals = `select count(*) as row_count${shown.length ? ', ' + sums(shown) : ''} ` +
    `from ${name}`;
  const grouped = `select ${sqlName(x)}, ${sums(shown.slice(0, 2))} from ${name} ` +
    `group by ${sqlName(x)} order by ${sqlName(x)}`;
  const stat = col => `    {id:${quote(col)}, ` +
    `label:${quote(`[Total ${label(col).toLowerCase()}]`)}, ` +
    `value: h => h.fmt(h.one('totals')[${quote(col)}])},`;
  const chart = col => `    {id:${quote(col)}, title:${quote(`[${label(col)} by ${x}]`)}, ` +
    `mark:'bar', query:${quote(by)}, x:${quote(x)}, y:${quote(col)}},`;
  const lead = first ? `\`[\${h.fmt(h.one('totals')[${quote(first)}])} ` +
    `${label(first).toLowerCase()} across \${h.one('totals').row_count} rows.]\`` :
    "`[${h.one('totals').row_count} rows.]`";
  return ['window.DATA = {',
    '  queries: {',
    `    totals: ${quote(totals)},`,
    ...shown.length ? [`    ${by}: ${quote(grouped)},`] : [],
    '  },',
    `  labels: {${columns.map(col => `${col}:${quote(label(col))}`).join(', ')}},`,
    "  kicker: '[Kicker]',",
    `  lead: h => ${lead},`,
    '  stats: [', ...shown.map(stat), '  ],',
    '  charts: [', ...shown.slice(0, 2).map(chart), '  ],',
    '  sections: [',
    "    {id:'reading', title:'[How to read this]', text: h => `[What the reader should take " +
      "from these ${h.one('totals').row_count} rows.]`},",
    '  ],', '};'].join('\n');
}
/** The starter with this CSV's link, DATA block and title in place of the sample's. */
function fill(starter, {title, name, columns, numbers}) {
  const start = starter.indexOf('window.DATA = {'), end = starter.indexOf('\n};', start) + 3;
  const sample = /data-af-name="(\w+)"/.exec(starter)?.[1];
  return (starter.slice(0, start) + dataBlock(name, columns, numbers) + starter.slice(end))
    .replace(`data-af-name="${sample}" href="./${sample}.csv"`, `data-af-name="${name}" ` +
      `href="./${name}.csv"`)
    .replace(/<title>\[[^\]<]+\]<\/title>/, `<title>${htmlText(title)}</title>`);
}
/** What the written DATA shows, in this CSV's names: what the agent keeps or changes. */
function draws(columns, numbers, rows) {
  const x = texts(columns, numbers)[0] ?? columns[0];
  return `DATA's SQL queries compute a total per number column (${numbers.slice(0, 3)
    .join(', ') || 'none'}) and ${numbers.slice(0, 2).map(y => `${y} summed per ${x}`)
    .join(' and ') || 'nothing'}; it draws a lead, those totals and a bar chart of each, with a ` +
    `table of its values (${rows.length} rows).`;
}
/** The usual changes, written with this CSV's own columns and a real value; the deeper ones
 * (panels, heatmap, linked filters, bins, scatter, map) as examples/csv-dashboard.html has them. */
function variations(columns, numbers, rows) {
  const x = texts(columns, numbers)[0] ?? columns[0];
  const other = texts(columns, numbers).find(column => column !== x);
  const y = numbers[0] ?? columns[1] ?? x, y2 = numbers[1];
  const at = col => rows[0]?.[columns.indexOf(col)] ?? '';
  const lat = columns.find(col => /^lat(itude)?$/i.test(col));
  const lon = columns.find(col => /^(lon|lng|long|longitude)$/i.test(col));
  const deeper = [other && `a small panel per ${other}: series:'${other}', multiples:true`,
    other && `a heatmap of ${x} by ${other}: mark:'rect', series:'${other}'`,
    other && `charts that filter each other: filters:{${other}:'${label(other)}'}, ` +
      `filter:'${other}' on a chart with x:'${other}', and where ($${other} is null or ` +
      `${other} = $${other}) in the other queries`,
    numbers.length && `the spread of ${y}: bars of count(*) per bin, cast(${y} / 10 as int) * ` +
      '10, grouped in SQL',
    y2 && `${y2} against ${y}: mark:'point', x:'${y2}', a row per record, table:false`,
    lat && lon && `a map: mark:'map', lat:'${lat}', lon:'${lon}', x the place, y its size`];
  return [`one line: mark:'line'`, other && `a line or bar per ${other}: select and group by ` +
    `${other} in the query, then series:'${other}'`,
    other && `only some rows: where ${other} = '${at(other)}' in the query`,
    `one value per ${x} as given: a query without sum or group by`,
    'no value table: table:false', 'no stats or sections: stats:[], sections:[]',
    `a number for one ${x} in a text: a query with sum(${y}) where ${x} = '${at(x)}', read as ` +
    `h.one(name).${y}`, 'another dataset: link it and join it in SQL',
    'and, as examples/csv-dashboard.html draws them: ' + deeper.filter(Boolean).join(', ')]
    .filter(Boolean).join('; ');
}
export async function newPageCommand({values, positionals}, options = {}) {
  const title = String(values.title ?? positionals.join(' ')).trim()
    .replace(/^\[(.*)\]$/, '$1').trim();
  if (!title) throw new ToolError('missing_title', 'The page needs a name.', 2, 'Run ' + USAGE);
  if (values.data === undefined) throw new ToolError('missing_data', 'The page needs its rows.',
    2, 'Pass the CSV: ' + USAGE);
  const base = options.cwd ?? process.cwd(), dir = resolve(base, values.dir ?? '.');
  const source = resolve(base, values.data), name = nameOf(source), file = name + '.csv';
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
  const measures = numbers.filter(column => !COORDINATE.test(column));
  await mkdir(dir, {recursive: true});
  const at = name => path.join(dir, name), created = [], kept = [], updated = [];
  const starter = await readFile(new URL('csv-dashboard.html', EXAMPLES), 'utf8');
  const steps = await readFile(new URL('csv-dashboard-steps.mjs', EXAMPLES));
  const renderer = await readFile(new URL('csv-dashboard.mjs', EXAMPLES));
  for (const [file2, bytes] of [['index.html', fill(starter, {title, name, columns,
    numbers: measures})], ['csv-dashboard.mjs', renderer], ['steps.mjs', steps]]) {
    (await create(at(file2), bytes) ? created : kept).push(file2);
  }
  // The copy is the dataset's source: it always takes the rows passed.
  const copy = await optionalFile(at(file));
  if (!copy) { await writeFile(at(file), csv); created.push(file); }
  else if (copy.toString('utf8') !== csv) { await writeFile(at(file), csv); updated.push(file); }
  else kept.push(file);
  const publish = await publishStep(at('index.html'), 'index.html', values.artifact);
  return {project: dir, title, created, kept, updated,
    dataset: {file, name, rows: rows.length, columns, numbers},
    note: `index.html links ${file} (${rows.length} rows) as ${name} and is titled ` +
      `${JSON.stringify(title)}; its first publish creates the ${name} dataset, and a later ` +
      `publish after ${file} changes updates that same dataset.`,
    draws: draws(columns, measures, rows), next: 'Next: in index.html edit only DATA (its ' +
      '[bracketed] text, and the stats, charts and sections the request needs); it can do the ' +
      `layout asked for: ${variations(columns, measures, rows)}; then ${publish} && ` +
      'node scripts/check.mjs index.html --steps steps.mjs'};
}
await runTool('new-page', import.meta.url, newPageCommand);
