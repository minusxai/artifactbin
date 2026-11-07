/**
 * scripts/toolbox-codebase.mjs: a git repository as the codebase report's three tables, read from a
 * fixture repository built here with fixed authors and dates (no global git config, no signing).
 * commits are one row per non-merge commit with its main area; files one row per tracked text file
 * (binaries and lockfiles left out) with its history in the window; imports only the file-to-file
 * imports that cross areas, resolved through relative paths, tsconfig paths, workspace packages and
 * Python modules.
 */
import {afterAll, beforeAll, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const TOOLBOX = '../../../skills/artifactbin/scripts/toolbox-codebase.mjs';
let repo = '';
const at = (date: string) => `${date}T12:00:00Z`;
function git(args: string[], who = 'Ada', date = '2026-01-05') {
  return execFileSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: who,
    GIT_AUTHOR_EMAIL: `${who.toLowerCase()}@example.test`, GIT_COMMITTER_NAME: who,
    GIT_COMMITTER_EMAIL: `${who.toLowerCase()}@example.test`, GIT_AUTHOR_DATE: at(date),
    GIT_COMMITTER_DATE: at(date)}});
}
async function commit(who: string, date: string, files: Record<string, string | Buffer | null>) {
  for (const [file, body] of Object.entries(files)) {
    if (body === null) { git(['rm', '-q', file], who, date); continue; }
    await mkdir(path.dirname(path.join(repo, file)), {recursive: true});
    await writeFile(path.join(repo, file), body);
  }
  git(['add', '--all'], who, date);
  git(['commit', '-q', '-m', `${who} on ${date}`], who, date);
}
const lines = (n: number, word = 'line') => Array.from({length: n}, (_, i) => `${word} ${i}\n`).join('');

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'codebase-'));
  git(['init', '-q', '-b', 'main']);
  await commit('Ada', '2026-01-05', {
    'README.md': lines(30), 'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["./web/*"]}}}\n',
    'package-lock.json': '{}\n', 'logo.png': Buffer.from([137, 80, 78, 71, 0, 0, 1]),
    'web/app.ts': "import {add} from '../lib/math.js';\nimport {thing} from 'shared/thing';\n" +
      "import './local.css';\n",
    'web/local.css': 'a{}\n', 'lib/math.ts': 'export const add = (a, b) => a + b;\n',
    'packages/shared/package.json': '{"name":"shared"}\n',
    'packages/shared/thing.ts': 'export const thing = 1;\n',
    'tools/cli.mjs': "const app = await import('@/app');\nconst math = require(\"../lib/math\");\n",
    'app/__init__.py': '', 'app/models.py': 'import os\nclass User: pass\n',
    'app/api/__init__.py': '', 'app/api/views.py': 'from ..models import User\nimport json\n',
    'scripts/run.py': 'from app.api.views import index\nimport app.models\n',
    'old/gone.ts': 'export {};\n',
  });
  await commit('Bo', '2026-01-14', {'lib/math.ts': "export const add = (a, b) => a + b;\n" +
    "export * from '../packages/shared/thing';\nexport const two = 2;\n",
  'web/app.ts': "import {add} from '../lib/math.js';\nimport {thing} from 'shared/thing';\n" +
    "import './local.css';\nexport const run = () => add(1, thing);\n"});
  // A side branch merged back: its commit counts, the merge commit does not.
  git(['checkout', '-q', '-b', 'side'], 'Ada', '2026-01-20');
  await commit('Ada', '2026-01-20', {'old/gone.ts': null, 'package-lock.json': '{"v":2}\n'});
  git(['checkout', '-q', 'main'], 'Ada', '2026-01-21');
  git(['merge', '-q', '--no-ff', 'side', '-m', 'merge'], 'Cy', '2026-01-21');
});
afterAll(() => rm(repo, {recursive: true, force: true}));

it('splits the largest areas into their biggest subdirectories, within the area budget', async () => {
  const {areasOf} = await import(TOOLBOX);
  const paths = ['src/a/1.ts', 'src/a/2.ts', 'src/b/1.ts', 'src/c.ts', 'docs/x.md', 'README.md'];
  expect(areasOf(paths)).toEqual(['(root)', 'docs', 'src', 'src/a', 'src/b']);
  // No room: src stays whole rather than losing its smaller subdirectories into it.
  expect(areasOf(paths, 3)).toEqual(['(root)', 'docs', 'src']);
  // Room for one more: the biggest subdirectory moves out, the rest stay in src.
  expect(areasOf(paths, 4)).toEqual(['(root)', 'docs', 'src', 'src/a']);
  // A directory with one subdirectory is that subdirectory.
  expect(areasOf(['app/src/a/x.ts', 'app/src/b/y.ts'])).toEqual(['app/src/a', 'app/src/b']);
});

it('reads commits, files and the imports between areas from the repository', async () => {
  const {gatherCodebase} = await import(TOOLBOX);
  const result = gatherCodebase(repo);
  expect(result.areas).toEqual(['(root)', 'app', 'app/api', 'lib', 'packages', 'scripts', 'tools', 'web']);
  expect(result.truncated).toEqual([]);
  expect(result.head).toBe(git(['rev-parse', '--short', 'HEAD']).trim());
  // Newest first, no merge commit; the lockfile change is left out, the deleted file keeps its old
  // directory as its area; a commit's area is where most of its lines changed.
  expect(result.commits.map(({commit, ...row}: {commit: string}) => (expect(commit).toMatch(/^[0-9a-f]{10}$/), row))).toEqual([
    {date: '2026-01-20', author: 'Ada', area: 'old', files: 1, added: 0, deleted: 1},
    {date: '2026-01-14', author: 'Bo', area: 'lib', files: 2, added: 3, deleted: 0},
    {date: '2026-01-05', author: 'Ada', area: '(root)', files: 15, added: 47, deleted: 0},
  ]);
  expect(result.tables.commits.split('\n')[0]).toBe('commit,date,author,area,files,added,deleted');
  // Text files only (no logo.png, no package-lock.json), most changed first.
  expect(result.files.map((file: {path: string}) => file.path)).not.toContain('logo.png');
  expect(result.files.map((file: {path: string}) => file.path)).not.toContain('package-lock.json');
  expect(result.files.slice(0, 2)).toEqual([
    {path: 'web/app.ts', area: 'web', language: 'TypeScript', lines: 4, changes: 2, churn: 4, authors: 2, last_change: '2026-01-14'},
    {path: 'lib/math.ts', area: 'lib', language: 'TypeScript', lines: 3, changes: 2, churn: 3, authors: 2, last_change: '2026-01-14'},
  ]);
  expect(result.files.find((file: {path: string}) => file.path === 'app/__init__.py')).toMatchObject({lines: 0, changes: 1, language: 'Python'});
  expect(result.tables.files.split('\n')[0]).toBe('path,area,language,lines,changes,churn,authors,last_change');
  // Imports between areas only (web/local.css is web's own), each resolved to a tracked file.
  expect(result.imports.map(({source, target}: {source: string; target: string}) => `${source} -> ${target}`)).toEqual([
    'app/api/views.py -> app/models.py',
    'lib/math.ts -> packages/shared/thing.ts',
    'scripts/run.py -> app/api/views.py',
    'scripts/run.py -> app/models.py',
    'tools/cli.mjs -> web/app.ts',
    'tools/cli.mjs -> lib/math.ts',
    'web/app.ts -> lib/math.ts',
    'web/app.ts -> packages/shared/thing.ts',
  ]);
  expect(result.tables.imports.split('\n').slice(0, 2)).toEqual(['source,target,source_area,target_area',
    'app/api/views.py,app/models.py,app/api,app']);
});

it('keeps the window, caps every table and says what it cut', async () => {
  const {gatherCodebase} = await import(TOOLBOX);
  const recent = gatherCodebase(repo, {since: '2026-01-10'});
  expect(recent.commits.map((row: {date: string}) => row.date)).toEqual(['2026-01-20', '2026-01-14']);
  expect(recent.files.find((file: {path: string}) => file.path === 'lib/math.ts')).toMatchObject({changes: 1, authors: 1});
  expect(recent.files.find((file: {path: string}) => file.path === 'README.md')).toMatchObject({changes: 0, last_change: ''});
  const capped = gatherCodebase(repo, {limit: 2});
  expect(capped.commits).toHaveLength(2);
  expect(capped.tables.files.trim().split('\n')).toHaveLength(3);
  expect(capped.truncated).toEqual(['commits: kept 2 of 3', 'files: kept 2 of 13', 'imports: kept 2 of 8']);
  // Nothing in the window: no commit rows (the command refuses that); a repository without imports
  // between areas still gets one row, which SQL's source_area <> target_area leaves out.
  expect(gatherCodebase(repo, {since: '2027-01-01'}).tables.commits).toBe('');
  const saved = repo;
  repo = await mkdtemp(path.join(tmpdir(), 'codebase-flat-'));
  try {
    git(['init', '-q', '-b', 'main']);
    await commit('Ada', '2026-01-05', {'a.ts': "import './b';\n", 'b.ts': 'export {};\n'});
    expect(gatherCodebase(repo).tables.imports)
      .toBe('source,target,source_area,target_area\n(root),(root),(root),(root)\n');
  } finally { await rm(repo, {recursive: true, force: true}); repo = saved; }
});

it('writes CSV a dataset reads back: quotes commas, quotes and line breaks', async () => {
  const {toCsv} = await import(TOOLBOX);
  expect(toCsv([{author: 'Lee, "Al"', n: 1}, {author: 'a\nb', n: 2}])).toBe('author,n\n"Lee, ""Al""",1\n"a\nb",2\n');
  expect(toCsv([])).toBe('');
});
