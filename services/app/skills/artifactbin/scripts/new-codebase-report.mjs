/** Command: a report on a codebase (examples/codebase-report.html) from its git repository. */
export const DESCRIPTION = `Set up a report on a codebase in one call, from its own repository:
how it changes, its hotspots, who works where and how its areas import each other. Reads the
commits since --since (no merges), the tracked text files and their JS/TS and Python imports into
commits.csv, files.csv and imports.csv in a project directory outside the repository; copies
examples/codebase-report.html as index.html, which links them by path (the page's first publish
creates the datasets commits, files and imports from them), and its steps file as steps.mjs, with
the title and the commit filled in; prints the facts to write the findings from. Nothing is sent
to the server.
Usage: node scripts/new-codebase-report.mjs --title NAME [--repo DIR] [--since WHEN]
  [--areas N] [--dir DIR] [--artifact ID]
Flags: --title NAME the page's name, for <title>; --repo DIR the repository (default: the one
  the current directory is in); --since WHEN the window, any date git reads (default "1 year
  ago"); --areas N at most N areas (default 20); --dir DIR the project directory, outside the
  repository (default: the system temp directory's artifactbin/REPO-report; created when
  missing); --artifact ID an existing page this one replaces (the printed publish command
  publishes over it). Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/new-codebase-report.mjs --title "How the API changes"
  node scripts/new-codebase-report.mjs --repo ~/src/shop --since "6 months ago" --title "Shop"
Gotchas: a rerun reads the repository again into the same CSVs (the next publish sends the new
  rows over the same datasets); index.html and steps.mjs are kept, only DATA.source is brought
  up to date. A table keeps at most 10,000 rows (the newest commits, the most changed
  files); truncated names what was cut, and a shorter --since keeps the window whole. Authors
  are git's names: a .mailmap merges one person's identities. Lockfiles and binary files are
  left out, and tests from imports; areas are the top directories, the largest split into its
  biggest subdirectories (--areas caps them).
Exit: 0 ok; 1 failed; 2 invalid (the one next step is printed). Results never contain
  credentials.`;

import path from 'node:path';
import {homedir, tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {runTool, ToolError} from './toolbox-client.mjs';
import {publishStep} from './toolbox-source.mjs';
import {gatherCodebase} from './toolbox-codebase.mjs';

const EXAMPLES = new URL('../examples/', import.meta.url);
const USAGE = 'node scripts/new-codebase-report.mjs --title NAME';
const TABLES = ['commits', 'files', 'imports'];
const resolve = (base, file) => path.resolve(base, String(file).replace(/^~(?=$|[\\/])/,
  homedir()));
const htmlText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quote = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const shell = file => /^[\w./:@-]+$/.test(file) ? file : JSON.stringify(file);
/** A path with its existing part's symlinks resolved, as git names the repository's top. */
const real = file => {
  try { return realpathSync(file); } catch {
    return path.dirname(file) === file ? file : path.join(real(path.dirname(file)),
      path.basename(file));
  }
};

async function create(file, bytes) {
  try { await writeFile(file, bytes, {flag: 'wx'}); return true; } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
/** The top directory of the repository `dir` lies in. */
function topOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    throw new ToolError('not_a_repository', `${dir} is not inside a git repository.`, 2,
      `Run it from inside the repository, or pass --repo DIR: ${USAGE} --repo DIR`);
  }
}
/** What the findings are written from, ranked as the page's queries rank them. */
function facts({commits, files, imports}) {
  const most = (rows, key) => [...rows.reduce((counts, row) => counts.set(key(row),
    (counts.get(key(row)) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, n]) => `${name} ${n}`).join('; ') || 'none';
  const hot = files.filter(file => file.changes && file.lines)
    .sort((a, b) => b.changes * b.lines - a.changes * a.lines).slice(0, 3)
    .map(file => `${file.path} (${file.changes} commits, ${file.lines} lines)`).join('; ');
  return [`hotspots: ${hot || 'none'}`, `commits by author: ${most(commits, row => row.author)}` +
    ` of ${commits.length}`, `commits by area: ${most(commits, row => row.area)}`,
  `file imports between areas: ${most(imports, row =>
    `${row.source_area} -> ${row.target_area}`)}`];
}
export async function newCodebaseReportCommand({values, positionals}, options = {}) {
  const title = String(values.title ?? positionals.join(' ')).trim()
    .replace(/^\[(.*)\]$/, '$1').trim();
  if (!title) throw new ToolError('missing_title', 'The report needs a name.', 2, 'Run ' + USAGE);
  const areas = values.areas === undefined ? 20 : Number(values.areas);
  if (!Number.isInteger(areas) || areas < 2) throw new ToolError('invalid_areas',
    '--areas takes a whole number of at least 2.', 2, `Run ${USAGE} --areas 12`);
  const base = options.cwd ?? process.cwd(), repo = topOf(resolve(base, values.repo ?? '.'));
  const name = path.basename(repo), since = String(values.since ?? '1 year ago');
  const dir = values.dir === undefined ? path.join(tmpdir(), 'artifactbin', `${name}-report`) :
    resolve(base, values.dir);
  const inside = path.relative(repo, real(dir));
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) throw new ToolError(
    'project_in_repository', `${dir} is inside the repository ${repo}.`, 2,
    'Leave out --dir (the project goes to the system temp directory) or pass one outside it.');
  const gathered = gatherCodebase(repo, {since, areas});
  if (!gathered.commits.length || !gathered.files.length) throw new ToolError('nothing_to_read',
    `${repo} has no ${gathered.commits.length ? 'tracked text files' : 'commits since ' + since}.`,
    2, `Pass a longer window: ${USAGE} --since "3 years ago"`);
  await mkdir(dir, {recursive: true});
  // The page links each CSV by path: its publish creates the dataset, or updates the one recorded.
  const datasets = {};
  for (const table of TABLES) {
    await writeFile(path.join(dir, table + '.csv'), gathered.tables[table]);
    datasets[table] = {file: table + '.csv', rows: gathered[table].length};
  }
  const source = `  source: {repo: ${quote(name)}, head: ${quote(gathered.head)}, ` +
    `since: ${quote(since)}},`, created = [], kept = [];
  const html = (await readFile(new URL('codebase-report.html', EXAMPLES), 'utf8'))
    .replace(/<title>\[[^\]<]+\]<\/title>/, `<title>${htmlText(title)}</title>`)
    .replace(/^ {2}source: \{.*\},$/m, () => source);
  const steps = await readFile(new URL('codebase-report-steps.mjs', EXAMPLES));
  for (const [file, bytes] of [['index.html', html], ['steps.mjs', steps]])
    (await create(path.join(dir, file), bytes) ? created : kept).push(file);
  if (kept.includes('index.html')) {
    const page = path.join(dir, 'index.html'), old = String(await readFile(page));
    await writeFile(page, old.replace(/^ {2}source: \{.*\},$/m, () => source));
  }
  const at = file => shell(dir === base ? file : path.join(dir, file));
  const publish = await publishStep(path.join(dir, 'index.html'), at('index.html'),
    values.artifact);
  return {project: dir, title, repo, head: gathered.head, since, created, kept, datasets,
    areas: gathered.areas, truncated: gathered.truncated, facts: facts(gathered),
    note: `Read ${name} at ${gathered.head}: ${TABLES.map(table => `${table}.csv ` +
      `(${datasets[table].rows} rows)`).join(', ')}` +
      (gathered.truncated.length ? `; truncated: ${gathered.truncated.join(', ')}` : '') + '.',
    next: `Next: in ${at('index.html')} edit only DATA: write the lead, each finding (what ` +
      'the reader should do, with the number that shows it) and each chart title from the ' +
      `facts above, removing every [bracket]; then ${publish} && node scripts/check.mjs ` +
      `${at('index.html')} --steps ${at('steps.mjs')}`};
}
await runTool('new-codebase-report', import.meta.url, newCodebaseReportCommand);
