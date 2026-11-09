/**
 * scripts/new-codebase-report.mjs against a fake server and a fixture repository: one call reads
 * the repository into three CSVs outside it, which the starter links by path (so the page's publish
 * creates the datasets commits, files and imports), and fills the starter and its steps file with the
 * title and the commit; a rerun rewrites the CSVs (the next publish updates the same datasets) and keeps
 * the page's edits. Nothing is sent to the server.
 */
import {afterAll, beforeAll, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const server = 'https://example.test';
let root = '', repo = '', name = '';
function git(args: string[], date = '2026-03-02') {
  return execFileSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.test', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.test',
    GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z`}});
}
async function commit(date: string, files: Record<string, string>) {
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), {recursive: true});
    await writeFile(path.join(repo, file), body);
  }
  git(['add', '--all'], date);
  git(['commit', '-q', '-m', 'change'], date);
}
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codebase-command-'));
  name = path.basename(root);
  repo = path.join(root, name);
  await mkdir(repo);
  git(['init', '-q', '-b', 'main']);
  await commit('2026-03-02', {'web/app.ts': "import {total} from '../lib/cart';\n", 'lib/cart.ts': 'export const total = 1;\n'});
});
afterAll(() => rm(root, {recursive: true, force: true}));

function fake() {
  const calls: Array<{method: string; path: string; body: any}> = [];
  let made = 0;
  const fetcher = async (url: string | URL, init: RequestInit = {}) => {
    const {pathname} = new URL(String(url)), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({method, path: pathname, body});
    const id = method === 'POST' && pathname === '/api/artifacts' ? 'DATA' + String(++made).padStart(4, '0') :
      method === 'PUT' ? /^\/api\/artifacts\/(\w+)$/.exec(pathname)?.[1] : undefined;
    if (!id) return Response.json({error: 'unexpected'}, {status: 500});
    return Response.json({id, url: `${server}/a/${id}`, version: method === 'PUT' ? 2 : 1,
      state: (method === 'PUT' ? 'b' : 'a').repeat(64), format: 'dataset'}, {status: method === 'PUT' ? 200 : 201});
  };
  return {calls, options: {env: {ARTIFACTBIN_URL: server, ARTIFACTBIN_TOKEN: 'private-fixture',
    ARTIFACTBIN_HOME: path.join(root, 'home')}, fetcher, cwd: path.join(repo, 'web'), log: () => {}}};
}
const run = async (values: Record<string, unknown>, options: object) => {
  const {newCodebaseReportCommand} = await import('../../../skills/artifactbin/scripts/new-codebase-report.mjs');
  return newCodebaseReportCommand({values: {server, ...values}, positionals: []}, options);
};

it('reads the repository it runs in into three datasets and fills the starter outside it', async () => {
  const {calls, options} = fake(), project = path.join(root, 'report');
  const result: any = await run({title: 'How the shop changes', dir: project}, options);
  expect(calls).toEqual([]);
  const head = git(['rev-parse', '--short', 'HEAD']).trim();
  expect(await readFile(path.join(project, 'commits.csv'), 'utf8')).toMatch(new RegExp(`^commit,date,author,area,files,added,deleted\\n${head}[0-9a-f]*,2026-03-02,Ada,`));
  expect(await readFile(path.join(project, 'imports.csv'), 'utf8')).toBe('source,target,source_area,target_area\nweb/app.ts,lib/cart.ts,web,lib\n');
  expect((await readdir(project)).sort()).toEqual(['commits.csv', 'files.csv', 'imports.csv', 'index.html', 'steps.mjs']);
  expect(result).toMatchObject({project, repo: realpathSync(repo), head, since: '1 year ago', created: ['index.html', 'steps.mjs'], kept: [],
    areas: ['lib', 'web'], truncated: [], datasets: {commits: {file: 'commits.csv', rows: 1},
      files: {file: 'files.csv', rows: 2}, imports: {file: 'imports.csv', rows: 1}}});
  expect(result.facts).toEqual(['hotspots: lib/cart.ts (1 commits, 1 lines); web/app.ts (1 commits, 1 lines)',
    'commits by author: Ada 1 of 1', 'commits by area: lib 1', 'file imports between areas: web -> lib 1']);
  const html = await readFile(path.join(project, 'index.html'), 'utf8');
  const starter = await readFile(new URL('../../../skills/artifactbin/examples/codebase-report.html', import.meta.url), 'utf8');
  expect(html).toContain('<title>How the shop changes</title>');
  for (const name of ['commits', 'files', 'imports'])
    expect(html).toContain(`data-af-name="${name}" href="./${name}.csv"`);
  expect(html).toContain(`  source: {repo: '${name}', head: '${head}', since: '1 year ago'},`);
  // Nothing else of the starter changes: DATA's queries, findings and charts are the agent's to write.
  const strip = (text: string) => text.replace(/<title>.*<\/title>|^ {2}source: .*$/gm, '');
  expect(strip(html)).toBe(strip(starter));
  expect(await readFile(path.join(project, 'steps.mjs'), 'utf8')).toBe(await readFile(
    new URL('../../../skills/artifactbin/examples/codebase-report-steps.mjs', import.meta.url), 'utf8'));
  expect(result.next).toBe(`Next: in ${project}/index.html edit only DATA: write the lead, each finding (what the reader ` +
    'should do, with the number that shows it) and each chart title from the facts above, removing every [bracket]; then ' +
    `node scripts/publish.mjs ${project}/index.html --create && node scripts/check.mjs ${project}/index.html --steps ${project}/steps.mjs`);

  // A rerun after a new commit: the CSVs get the new rows (the next publish sends them over the same
  // datasets), the edited page is kept and only its source line follows the repository.
  await writeFile(path.join(project, 'index.html'), html.replace('[Who works where]', 'Ada owns both areas'));
  await commit('2026-03-09', {'lib/cart.ts': 'export const total = 2;\n'});
  const again: any = await run({title: 'How the shop changes', dir: project, artifact: 'PAGE01'}, options);
  expect(calls).toEqual([]);
  expect((await readFile(path.join(project, 'commits.csv'), 'utf8')).split('\n')).toHaveLength(4);
  expect(again).toMatchObject({created: [], kept: ['index.html', 'steps.mjs'], datasets: {commits: {file: 'commits.csv', rows: 2}}});
  expect((await readdir(project)).filter(file => file.endsWith('.af.json'))).toEqual([]);
  const edited = await readFile(path.join(project, 'index.html'), 'utf8'), newHead = git(['rev-parse', '--short', 'HEAD']).trim();
  expect(edited).toContain('Ada owns both areas');
  expect(edited).toContain(`  source: {repo: '${name}', head: '${newHead}', since: '1 year ago'},`);
  expect(again.next).toContain(`node scripts/publish.mjs ${project}/index.html --artifact PAGE01 && node scripts/check.mjs`);
});

it('puts the project in the system temp directory by default, never in the repository', async () => {
  const {calls, options} = fake();
  const result: any = await run({title: 'Shop'}, options);
  try {
    expect(result.project).toBe(path.join(tmpdir(), 'artifactbin', name + '-report'));
    expect(calls).toEqual([]);
    expect(git(['status', '--porcelain'])).toBe('');
  } finally { await rm(result.project, {recursive: true, force: true}); }
});

it('refuses, with the one next step, a project inside the repository, a folder that is no repository, an empty window and bad --areas', async () => {
  const {calls, options} = fake();
  await expect(run({title: 'Shop', dir: path.join(repo, 'report')}, options)).rejects
    .toMatchObject({code: 'project_in_repository', exit: 2});
  await expect(run({title: 'Shop', repo: root}, options)).rejects.toMatchObject({code: 'not_a_repository', exit: 2});
  await expect(run({title: 'Shop', since: '2030-01-01', dir: path.join(root, 'r2')}, options)).rejects
    .toMatchObject({code: 'nothing_to_read', exit: 2, recovery: expect.stringContaining('--since')});
  await expect(run({title: 'Shop', areas: '1'}, options)).rejects.toMatchObject({code: 'invalid_areas', exit: 2});
  await expect(run({}, options)).rejects.toMatchObject({code: 'missing_title', exit: 2});
  expect(calls).toEqual([]);
});
