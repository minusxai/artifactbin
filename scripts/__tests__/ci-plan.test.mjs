import { describe, expect, it } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'yaml';
import { createServer } from 'node:http';
import { CI_JOBS, CI_MODULES, checkCiResults, isBuildInput, planCi } from '../lib/ci-plan.mjs';
import { supersededRuns } from '../lib/ci-supersede.mjs';
import { CI_GATE_SHARDS, CI_ISOLATED_GATES, CI_SHARD_OPTIONS, gateNamesOnDisk, shardWeight, specFor } from '../gates.manifest.mjs';
import { shardOf } from '../gates.shard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts/ci/ci.mjs');

describe('CI change selection', () => {
  it('covers all declared workspace dependency edges', () => {
    const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const directory of workspace.workspaces) {
      const pkg = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
      // A workspace outside services/ (docs/proposals/runner-validation, installed with the rest so CI
      // pays one install) is no CI module: it may not depend on one, or an edge would go unseen.
      if (!directory.startsWith('services/')) {
        expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('@artifactbin/')), directory).toEqual([]);
        continue;
      }
      const module = directory.split('/')[1];
      expect(CI_MODULES).toHaveProperty(module);
      for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (dependency.startsWith('@artifactbin/')) {
          expect(CI_MODULES[module], `${module} depends on ${dependency}`).toContain(dependency.slice('@artifactbin/'.length));
        }
      }
    }
  });
  it('runs everything on main and on uncertain/shared inputs', () => {
    for (const paths of [['package-lock.json'], ['services/contracts/src/remote.ts'], ['services/utils/src/index.ts'],
      ['vitest.config.ts'], ['.github/workflows/ci.yml'], ['services/new-service/src/index.ts'],
      ['services/app/package.json'], ['unexpected.txt']]) {
      expect(planCi(paths).jobs, paths.join()).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, true])));
    }
    expect(planCi(['README.md'], { full: true }).full).toBe(true);
  });

  it('skips expensive jobs only for explicitly classified prose', () => {
    const plan = planCi(['README.md', 'docs/notifications.md', 'AGENTS.md']);
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks']);
    expect(planCi(['services/app/skills/artifactbin/SKILL.md']).jobs.api).toBe(true);
    expect(planCi(['docs/executable.mjs']).full).toBe(true);
  });

  it('runs workflow contracts for scanner-only changes without product journeys', () => {
    const inputs = ['.github/workflows/codeql.yml', 'scripts/__tests__/workflows.test.mjs'];
    const plan = planCi(inputs);
    expect(plan.full).toBe(false);
    expect(plan.nodeRoots).toEqual(['scripts/']);
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks', 'node', 'integration']);
    expect(planCi([...inputs, 'services/app/lib/auth/auth.ts']).jobs.gates).toBe(true);
    expect(planCi([...inputs, '.github/workflows/ci.yml']).full).toBe(true);
    expect(planCi(inputs, {full: true}).full).toBe(true);
  });

  it('selects the app without standalone service tests', () => {
    const plan = planCi(['services/app/components/AnnotationLayer.tsx']);
    expect(plan.nodeRoots).toEqual(['scripts/', 'services/app/']);
    expect(plan.jobs).toMatchObject({ api: true, ui: true, build: true, gates: true });
    // THE CONTAINER DISTRIBUTION IS RETIRED: there is no image to build and no job named for one.
    expect(Object.keys(plan.jobs)).not.toContain('image');
    expect(CI_JOBS).not.toContain('image');
  });

  // The gate shards run what `build` built, so a plan that wants gates must select the job that
  // produces the artifact they download.
  it('never selects the gates without the build that feeds them', () => {
    for (const paths of [['services/app/components/AnnotationLayer.tsx'], ['services/sql/src/engine.ts'],
      ['package-lock.json'], ['services/runner/src/index.ts'], ['README.md']]) {
      const { jobs } = planCi(paths);
      if (jobs.gates) expect(jobs.build, paths.join()).toBe(true);
    }
  });

  it('expands transitive test/composition dependents for a service', () => {
    const plan = planCi(['services/sql/src/engine.ts']);
    expect(plan.nodeRoots).toEqual(['scripts/', 'services/app/', 'services/sql/']);
    expect(plan.jobs.api).toBe(true);
  });

  it('combines both sides of renames, deletions and mixed changes', () => {
    const plan = planCi(['services/sql/src/old.ts', 'services/browser/src/new.ts', 'README.md']);
    expect(plan.nodeRoots).toContain('services/sql/');
    expect(plan.nodeRoots).toContain('services/browser/');
    expect(planCi([]).full).toBe(true);
  });
});

/** MERGE TO PRODUCTION rests on a selection that is not about affected modules at all: a tree this repository already tested. */
describe('a tree is tested once', () => {
  it('selects no job at all — not even checks — when a green run already tested this tree', () => {
    const plan = planCi(['services/app/components/AnnotationLayer.tsx'], { testedRun: '4242' });
    expect(Object.values(plan.jobs).some(Boolean), 'every job is skipped').toBe(false);
    expect(plan.testedRun).toBe('4242');
    expect(plan.nodeRoots).toEqual([]);
    // And the roll-up must accept that: every selected job (there are none) succeeded.
    expect(checkCiResults(plan, Object.fromEntries(CI_JOBS.map((job) => [job, 'skipped'])))).toEqual([]);
  });

  it('plans normally when nothing tested this tree', () => {
    expect(planCi(['services/app/x.ts'], { testedRun: null }).jobs.api).toBe(true);
  });
});

describe('GitHub CI adapter', () => {
  it('uses both sides of a real rename and falls back to full when history is unavailable', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'artifactbin-ci-'));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git('init');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/sql'), { recursive: true });
      mkdirSync(path.join(cwd, 'services/browser'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/sql/old.ts'), 'fixture');
      git('add', '.'); git('commit', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      git('mv', 'services/sql/old.ts', 'services/browser/new.ts');
      git('commit', '-m', 'rename');
      const head = git('rev-parse', 'HEAD');
      const output = path.join(cwd, 'outputs');
      const run = (baseSha) => JSON.parse(execFileSync(process.execPath, [script, 'plan'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI__EVENT: 'pull_request', CI__BASE_SHA: baseSha, CI__HEAD_SHA: head,
          GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' },
      }));
      expect(run(base)).toMatchObject({ full: false, nodeRoots: ['scripts/', 'services/app/', 'services/browser/', 'services/sql/'] });
      expect(run('0000000000000000000000000000000000000000').full).toBe(true);
      expect(readFileSync(output, 'utf8')).toContain('api=true\n');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  /** A repository with the app module and a lockfile. */
  const repositoryFixture = (cwd) => {
    mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
    writeFileSync(path.join(cwd, 'package-lock.json'), '{\n  "packages": {}\n}\n');
  };

  const readOutputs = (output) => Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

  const planOutput = (cwd, env) => {
    const output = path.join(cwd, `outputs-${Math.random()}`);
    execFileSync(process.execPath, [script, 'plan'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', ...env },
    });
    return readOutputs(output);
  };

  /** The same, without blocking this process — a test that SERVES the planner's API call must not
   * hold the event loop while the planner waits on it. */
  const planOutputServed = async (cwd, env) => {
    const output = path.join(cwd, `outputs-${Math.random()}`);
    await promisify(execFile)(process.execPath, [script, 'plan'], {
      cwd, encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', ...env },
    });
    return readOutputs(output);
  };

  it('selects nothing when a green run already tested this tree, and everything when the lookup cannot answer', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-tested-tree-'));
    const asked = [];
    let answer = { status: 200, body: { artifacts: [{ id: 7, expired: false, workflow_run: { id: 4242 } }] } };
    const api = createServer((request, response) => {
      asked.push(request.url);
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      repositoryFixture(cwd);
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'an ordinary merge');
      const head = git('rev-parse', 'HEAD');
      const tree = git('rev-parse', 'HEAD^{tree}');
      const env = {
        CI__EVENT: 'push', CI__BEFORE_SHA: base, CI__HEAD_SHA: head,
        GITHUB_REPOSITORY: 'minusxai/artifactbin', GH_TOKEN: 'mxmx_test_token',
        GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
      };
      const reused = await planOutputServed(cwd, env);
      expect(asked[0]).toBe(`/repos/minusxai/artifactbin/actions/artifacts?name=tested-tree-${tree}&per_page=100`);
      expect(reused['source-run']).toBe('4242');
      for (const job of CI_JOBS) expect(reused[job], job).toBe('false');
      // An expired artifact is not evidence, and neither is an API that will not answer.
      answer = { status: 200, body: { artifacts: [{ id: 7, expired: true, workflow_run: { id: 4242 } }] } };
      const expired = await planOutputServed(cwd, env);
      expect(expired.checks).toBe('true');
      expect(expired['source-run']).toBe('');
      answer = { status: 500, body: { message: 'nope' } };
      const fallback = await planOutputServed(cwd, env);
      for (const job of CI_JOBS) expect(fallback[job], job).toBe('true');
      // A pull request never reuses: it is the run that RECORDS the tree.
      expect((await planOutputServed(cwd, { ...env, CI__EVENT: 'pull_request', CI__BASE_SHA: base })).api).toBe('true');
    } finally {
      api.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  /** A one-file GitHub Actions artifact zip, the shape `readArtifactJson` unzips. */
  const artifactZip = (dir, fileName, content) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, fileName), JSON.stringify(content));
    const zipPath = path.join(dir, 'artifact.zip');
    execFileSync('zip', ['-q', '-j', zipPath, path.join(dir, fileName)], { cwd: dir });
    return readFileSync(zipPath);
  };

  /** Serves a tree-miss and one patch match (its zip content given as `record`), everything else 404. */
  const patchServer = (patchId, artifactId, zipBytes) => createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const name = url.searchParams.get('name');
    if (url.pathname === '/repos/minusxai/artifactbin/actions/artifacts' && name?.startsWith('tested-tree-')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ artifacts: [] }));
    } else if (url.pathname === '/repos/minusxai/artifactbin/actions/artifacts' && name === `tested-patch-${patchId}`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ artifacts: [{ id: artifactId, expired: false }] }));
    } else if (url.pathname === `/repos/minusxai/artifactbin/actions/artifacts/${artifactId}/zip`) {
      response.writeHead(200, { 'content-type': 'application/zip' });
      response.end(zipBytes);
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ artifacts: [] }));
    }
  });

  it('reuses a tested patch when a moved base leaves its own files untouched (a moved-base merge)', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-patch-reuse-'));
    const zipDir = mkdtempSync(path.join(tmpdir(), 'ci-patch-zip-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      mkdirSync(path.join(cwd, 'services/sql'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/existing.ts'), 'export const existing = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');

      // PR A, tested by an earlier run against `base` alone: adds services/app/x.ts.
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR A: add x');
      const patchDiff = execFileSync('git', ['diff', '--no-renames', `${base}..HEAD`], { cwd, encoding: 'utf8' });
      const [patchId] = execFileSync('git', ['patch-id', '--stable'], { input: patchDiff, encoding: 'utf8' }).trim().split(/\s+/);
      git('reset', '-q', '--hard', base);

      // PR B merges FIRST, moving main's tip: a disjoint file.
      writeFileSync(path.join(cwd, 'services/sql/y.ts'), 'export const y = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR B: add y');
      const before = git('rev-parse', 'HEAD');

      // PR A's squash-merge onto the new tip: the identical patch, applied past B.
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR A merged after B');
      const head = git('rev-parse', 'HEAD');
      expect(execFileSync('git', ['diff', '--no-renames', `${before}..${head}`], { cwd, encoding: 'utf8' })).toBe(patchDiff);

      const zipBytes = artifactZip(zipDir, 'tested-patch.json', { run_id: 4242, base });
      const api = patchServer(patchId, 900, zipBytes);
      await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
      try {
        const env = {
          CI__EVENT: 'push', CI__BEFORE_SHA: before, CI__HEAD_SHA: head, GITHUB_RUN_ID: '5000',
          GITHUB_REPOSITORY: 'minusxai/artifactbin', GH_TOKEN: 'mxmx_test_token',
          GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
        };
        // Disjoint: B never touched services/app/x.ts. Safe to skip re-testing A's own patch.
        const reused = await planOutputServed(cwd, env);
        expect(reused['source-run']).toBe('5000');
        for (const job of CI_JOBS) expect(reused[job], job).toBe('false');
      } finally {
        api.close();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(zipDir, { recursive: true, force: true });
    }
  });

  it('does not reuse a patch match whose tested base is not even history this push descends from', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-patch-unrelated-'));
    const zipDir = mkdtempSync(path.join(tmpdir(), 'ci-patch-zip2-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/existing.ts'), 'export const existing = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');

      // PR A, tested by an earlier run against `base`.
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR A: add x');
      const patchDiff = execFileSync('git', ['diff', '--no-renames', `${base}..HEAD`], { cwd, encoding: 'utf8' });
      const [patchId] = execFileSync('git', ['patch-id', '--stable'], { input: patchDiff, encoding: 'utf8' }).trim().split(/\s+/);

      // An UNRELATED history — this push's own lineage never contains `base` at all (imagine a
      // repository migration, a force-push, or simply a patch-id collision): the tested patch's base
      // is not an ancestor of this push's own base, so it must not stand in even though the resulting
      // edit (adding the same file, same bytes) is byte-for-byte identical and the patch id matches.
      git('checkout', '-q', '--orphan', 'disconnected');
      execFileSync('git', ['rm', '-rf', '-q', '.'], { cwd });
      writeFileSync(path.join(cwd, 'unrelated.txt'), 'unrelated root\n');
      git('add', '.'); git('commit', '-q', '-m', 'an unrelated root');
      const before = git('rev-parse', 'HEAD');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'the same edit, unrelated lineage');
      const head = git('rev-parse', 'HEAD');
      expect(execFileSync('git', ['diff', '--no-renames', `${before}..${head}`], { cwd, encoding: 'utf8' })).toBe(patchDiff);

      const zipBytes = artifactZip(zipDir, 'tested-patch.json', { run_id: 4242, base });
      const api = patchServer(patchId, 901, zipBytes);
      await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
      try {
        const env = {
          CI__EVENT: 'push', CI__BEFORE_SHA: before, CI__HEAD_SHA: head,
          GITHUB_REPOSITORY: 'minusxai/artifactbin', GH_TOKEN: 'mxmx_test_token',
          GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
        };
        const retested = await planOutputServed(cwd, env);
        expect(retested['source-run']).toBe('');
        expect(retested.node).toBe('true');
      } finally {
        api.close();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(zipDir, { recursive: true, force: true });
    }
  });

  it('records the tested tree', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-record-tree-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      writeFileSync(path.join(cwd, 'file.txt'), 'one');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const tree = git('rev-parse', 'HEAD^{tree}');
      const output = path.join(cwd, 'outputs');
      const summary = path.join(cwd, 'summary');
      writeFileSync(summary, '');
      execFileSync(process.execPath, [script, 'record-tree'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_RUN_ID: '99', GITHUB_SHA: 'a'.repeat(40) },
      });
      expect(JSON.parse(readFileSync(path.join(cwd, 'tested-tree/tested-tree.json'), 'utf8')))
        .toEqual({ run_id: 99, head_sha: 'a'.repeat(40), tree });
      expect(readFileSync(output, 'utf8')).toContain(`tree=${tree}\n`);
      expect(readFileSync(summary, 'utf8')).toBe(`tree ${tree} tested by run 99\n`);
      // On a reusing push the summary names the run that tested the tree.
      execFileSync(process.execPath, [script, 'record-tree'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_RUN_ID: '100', CI__SOURCE_RUN: '4242' },
      });
      expect(readFileSync(summary, 'utf8')).toContain(`tree ${tree} tested by run 4242\n`);
      // A push never records a patch — it is testing a PR's, not minting one — so the second call
      // above (a push shape: no CI__EVENT, no CI__BASE_SHA) wrote no patch-id and no patch file.
      expect(readFileSync(output, 'utf8')).toContain('patch-id=\n');
      expect(existsSync(path.join(cwd, 'tested-patch'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('records a pull request\'s patch too, base and all, keyed by content so a moved base still finds it', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-record-patch-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      writeFileSync(path.join(cwd, 'file.txt'), 'one');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'a PR');
      const head = git('rev-parse', 'HEAD');
      const output = path.join(cwd, 'outputs');
      execFileSync(process.execPath, [script, 'record-tree'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', GITHUB_RUN_ID: '55', CI__EVENT: 'pull_request', CI__BASE_SHA: base },
      });
      const outputs = readOutputs(output);
      expect(outputs['patch-id']).toMatch(/^[0-9a-f]{40}$/);
      expect(JSON.parse(readFileSync(path.join(cwd, 'tested-patch/tested-patch.json'), 'utf8')))
        .toEqual({ run_id: 55, base });
      // Rebuilt as a push would see it — the same file addition, applied straight onto `base` rather
      // than through the PR's three-dot range — the patch id is identical: it is content, not notation.
      const diff = execFileSync('git', ['diff', '--no-renames', `${base}...${head}`], { cwd, encoding: 'utf8' });
      const rebuilt = execFileSync('git', ['diff', '--no-renames', `${base}..${head}`], { cwd, encoding: 'utf8' });
      expect(rebuilt).toBe(diff);
      const [patchId] = execFileSync('git', ['patch-id', '--stable'], { input: diff, encoding: 'utf8' }).trim().split(/\s+/);
      expect(patchId).toBe(outputs['patch-id']);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('keeps the install cache key blind to the version a release moves', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-fingerprint-'));
    try {
      const fingerprint = (version) => {
        writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({
          name: 'artifactbin',
          packages: { '': { version: '0.1.0' }, 'services/app': { version }, 'node_modules/left-pad': { version: '1.3.0' } },
        }));
        execFileSync(process.execPath, [script, 'lock-fingerprint'], { cwd, encoding: 'utf8' });
        return readFileSync(path.join(cwd, '.ci-cache-key/install.json'), 'utf8');
      };
      expect(fingerprint('0.1.44')).toBe(fingerprint('0.1.45'));
      // A dependency that actually moved must still change the key.
      const before = fingerprint('0.1.44');
      writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({
        name: 'artifactbin',
        packages: { '': { version: '0.1.0' }, 'services/app': { version: '0.1.44' }, 'node_modules/left-pad': { version: '1.3.1' } },
      }));
      execFileSync(process.execPath, [script, 'lock-fingerprint'], { cwd, encoding: 'utf8' });
      expect(readFileSync(path.join(cwd, '.ci-cache-key/install.json'), 'utf8')).not.toBe(before);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('runs the roll-up from GitHub-shaped results and refuses planner failure', () => {
    const plan = planCi(['README.md']);
    const needs = Object.fromEntries(CI_JOBS
      .map((j) => [j, { result: plan.jobs[j] ? 'success' : 'skipped' }]));
    needs.plan = { result: 'success', outputs: { plan: JSON.stringify(plan) } };
    const run = () => spawnSync(process.execPath, [script, 'check'], {
      env: { ...process.env, CI__NEEDS: JSON.stringify(needs) }, encoding: 'utf8',
    }).status;
    expect(run()).toBe(0);
    needs.checks.result = 'skipped';
    expect(run()).toBe(1);
    needs.checks.result = 'success';
    needs.plan.result = 'failure';
    expect(run()).toBe(1);
  });

  it('wires every conditional job to the planner and the required roll-up', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    for (const job of CI_JOBS) {
      expect(jobs[job].needs).toContain('plan');
      expect(jobs[job].if).toContain(`needs.plan.outputs.${job} == 'true'`);
      expect(jobs.plan.outputs[job]).toBe(`\${{ steps.select.outputs.${job} }}`);
      expect(jobs.test.needs).toContain(job);
    }
    expect(jobs.test.needs).toContain('plan');
    expect(jobs.test.if).toBe("always()");
    expect(jobs.node.steps.some((step) => step.run?.includes('scripts/ci/ci.mjs node'))).toBe(true);
  });
});

describe('required CI result', () => {
  const plan = () => planCi(['services/sql/src/engine.ts']);
  const results = (p) => Object.fromEntries(CI_JOBS.map((j) => [j, p.jobs[j] ? 'success' : 'skipped']));

  it('accepts intentional skips and successful selected jobs', () => {
    const p = plan();
    expect(checkCiResults(p, results(p))).toEqual([]);
  });
  it('rejects failures, cancellation, missing results and unexpectedly skipped selected jobs', () => {
    const p = plan();
    for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
      expect(checkCiResults(p, { ...results(p), gates: status })).toContain('gates');
    }
    expect(checkCiResults(p, { ...results(p), api: 'failure' })).toContain('api');
  });
});

describe('CI avoids superseded work and duplicate integration setup', () => {
  it('cancels earlier runs only for the same PR, never main, and never makes the new run wait for them', () => {
    const workflow = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    // A workflow-level group with cancel-in-progress holds the new run pending until the old one has stopped.
    expect(workflow.concurrency).toBeUndefined();
    const job = workflow.jobs.supersede;
    expect(job.if).toBe("github.event_name == 'pull_request'");
    expect(job.needs).toBeUndefined();
    expect(job.permissions).toEqual({ contents: 'read', actions: 'write' });
    const cancel = job.steps.find(step => step.run === 'node scripts/lib/ci-supersede.mjs');
    expect(cancel.env).toMatchObject({ HEAD_REPOSITORY: '${{ github.event.pull_request.head.repo.full_name }}', HEAD_REF: '${{ github.event.pull_request.head.ref }}', WORKFLOW_FILE: 'ci.yml' });
    // Nothing waits for it: neither the roll-up nor any job that feeds it.
    for (const [name, other] of Object.entries(workflow.jobs)) expect([other.needs ?? []].flat(), name).not.toContain('supersede');
  });
  it('supersedes only this PR\'s earlier, unfinished runs from the same head repository and branch', () => {
    const self = { runId: 500, headRepository: 'minusxai/artifactbin', headBranch: 'fix/x' };
    const run = (id, status, extra = {}) => ({ id, status, head_branch: 'fix/x', head_repository: { full_name: 'minusxai/artifactbin' }, ...extra });
    expect(supersededRuns([
      run(499, 'in_progress'), run(498, 'queued'), run(497, 'completed'), run(501, 'in_progress'), run(500, 'in_progress'),
      run(496, 'in_progress', { head_repository: { full_name: 'someone/fork' } }), run(495, 'waiting', { head_branch: 'fix/y' }),
      run(494, 'in_progress', { head_repository: null }),
    ], self)).toEqual([499, 498]);
    expect(supersededRuns([run(1, 'in_progress')], { ...self, headRepository: '' })).toEqual([]);
    expect(supersededRuns([run(1, 'in_progress')], { ...self, runId: Number.NaN })).toEqual([]);
  });
  it('runs both ends of the chain, plan and roll-up, on the runner\'s own Node with builtin-only scripts', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    for (const job of ['plan', 'test', 'supersede']) {
      expect(jobs[job].steps.filter(step => step.uses?.startsWith('actions/setup-node@')), job).toEqual([]);
      expect(jobs[job].steps.filter(step => /\bnpm (ci|install)\b/.test(step.run ?? '')), job).toEqual([]);
    }
    const scripts = [...new Set(['plan', 'test', 'supersede'].flatMap(job => jobs[job].steps.flatMap(step => [...(step.run ?? '').matchAll(/node (scripts\/\S+\.mjs)/g)].map(match => match[1]))))];
    expect(scripts).toEqual(expect.arrayContaining(['scripts/ci/ci.mjs', 'scripts/lib/ci-elapsed.mjs', 'scripts/lib/ci-supersede.mjs']));
    // Every module those scripts load, transitively: Node builtins or this repository's own builtin-only modules.
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const [, specifier] of readFileSync(path.join(root, file), 'utf8').matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        if (specifier.startsWith('node:')) continue;
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\.?\//);
        visit(path.relative(root, path.resolve(path.dirname(path.join(root, file)), specifier)));
      }
    };
    for (const script of scripts) visit(script);
    expect(seen.size).toBeGreaterThan(scripts.length);
  });
  it('provisions Chromium and Postgres only for the integration project, in its own job beside the node shards', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.steps.filter(step => step.id === 'playwright' || /playwright install|docker pull|test:integration/.test(step.run ?? ''))).toEqual([]);
    const steps = jobs.integration.steps;
    expect(jobs.integration.needs).toEqual(['plan']);
    expect(jobs.integration.if).toBe("needs.plan.outputs.integration == 'true'");
    const run = steps.findIndex(step => step.run === 'npm run test:integration');
    for (const provision of [step => step.id === 'playwright', step => step.run === 'npx playwright install chromium', step => step.run === 'docker pull postgres:17-alpine']) {
      const at = steps.findIndex(provision);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(run);
    }
    expect(planCi(['scripts/x.mjs']).jobs.integration).toBe(true);
    expect(planCi(['docs/notes.md']).jobs.integration).toBe(false);
  });
  it('leaves every node shard to Vitest alone: no shard is preloaded with other work', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.steps.filter(step => step.if?.includes('matrix.shard'))).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(root, 'scripts/ci/test-timings.json'), 'utf8')).reserve).toBeUndefined();
  });
  it('splits the node project into four shards, and every shard runs its fourth', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(jobs.node.name).toBe('node tests (${{ matrix.shard }}/4)');
    expect(jobs.node.steps.find(step => (step.run ?? '').startsWith('node scripts/ci/ci.mjs node')).run).toBe('node scripts/ci/ci.mjs node ${{ matrix.shard }}/4');
  });
  it('splits the ui and islands projects into two shards, and every shard runs its half', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.ui.strategy.matrix.shard).toEqual([1, 2]);
    expect(jobs.ui.name).toBe('ui tests (${{ matrix.shard }}/2)');
    expect(jobs.ui.steps.find(step => (step.run ?? '').includes('vitest run --project=ui')).run)
      .toBe('npx vitest run --project=ui --project=islands --shard=${{ matrix.shard }}/2');
  });
  it('spreads the API test files over four shards without dropping a shard', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.api.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(jobs.api.name).toBe('api tests (${{ matrix.shard }}/4)');
    expect(jobs.api.steps.find(step => (step.run ?? '').includes('vitest run --project=api')).run)
      .toBe('npx vitest run --project=api --project=api-isolated --shard=${{ matrix.shard }}/4');
  });
  it('restores the test global setup\'s builds before every Vitest shard and the app build run', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    for (const [name, runs] of [['api', 'vitest run'], ['node', 'ci.mjs node'], ['integration', 'test:integration'], ['ui', 'vitest run'], ['build', 'npm run build']]) {
      const steps = jobs[name].steps;
      const restore = steps.findIndex(step => step.id === 'test-builds');
      expect(restore, name).toBeGreaterThan(steps.findIndex(step => step.id === 'install'));
      expect(restore, name).toBeLessThan(steps.findIndex(step => (step.run ?? '').includes(runs)));
      expect(steps[restore].with.path).toContain('node_modules/.cache/build-islands.json');
    }
    expect(jobs['warm-caches'].steps.some(step => (step.uses ?? '').startsWith('actions/cache/save') && step.with.key.startsWith('test-builds-v1-'))).toBe(true);
  });
});

/**
 * The three-minute budget is held by the SHAPE of the workflow — what runs where, and how often —
 * never by a cap or a threshold. Nothing below asserts a duration: a job that runs long must be
 * fixed at its cause, and a test that failed on seconds would only teach everyone to re-run.
 */
describe('CI job shape', () => {
  const ci = () => yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = (jobs) => Object.values(jobs).flatMap((job) => job.steps ?? []);

  it('restores the whole install, so no job re-runs the postinstall by hand', () => {
    for (const workflow of [ci()]) {
      const caches = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).filter((step) => step.id === 'install');
      expect(caches.length).toBeGreaterThan(0);
      for (const cache of caches) {
        // The postinstall's products live OUTSIDE node_modules; cached apart, a cache hit (which
        // skips `npm ci`, and so the postinstall) would leave every document without its fonts.
        expect(cache.with.path).toContain('node_modules');
        expect(cache.with.path).toContain('services/app/public/fonts');
        expect(cache.with.path).toContain('services/app/lib/story-design/story-font-manifest.json');
        // Keyed on the lockfile, but not on the one line of it a release rewrites: the fingerprint
        // is that file with workspace versions normalised, written by the step just above.
        expect(cache.with.key).toMatch(/hashFiles\('(candidate\/package-lock\.json|\.ci-cache-key\/install\.json)'/);
        if (cache.with.key.includes('.ci-cache-key')) {
          const job = Object.values(workflow.jobs).find((entry) => (entry.steps ?? []).includes(cache));
          expect(job.steps.indexOf(cache), 'the fingerprint is written first').toBeGreaterThan(
            job.steps.findIndex((step) => step.run === 'node scripts/ci/ci.mjs lock-fingerprint'));
        }
      }
      for (const step of steps(workflow.jobs)) expect(step.run ?? '').not.toContain('copy-assets.mjs');
    }
  });


  it('fans the gate set over nine runners, none of which pulls Postgres', () => {
    const { jobs } = ci();
    expect(jobs.gates.strategy.matrix.shard).toEqual(Array.from({ length: CI_GATE_SHARDS }, (_, index) => index + 1));
    const run = jobs.gates.steps.find((step) => step.name === 'every gate, two servers');
    expect(run.run).toContain('--servers=2');
    expect(run.run).toContain(`--shard=\${{ matrix.shard }}/${CI_GATE_SHARDS}`);
    const browser = jobs.gates.steps.find((step) => step.id === 'browser-chromium');
    expect(browser.with.key).toContain("hashFiles('node_modules/playwright-core/browsers.json')");
    const selection = jobs.gates.steps.find(step => step.id === 'gate-browsers');
    expect(selection.run).toContain(`--browsers --shard=\${{ matrix.shard }}/${CI_GATE_SHARDS}`);
    const install = jobs.gates.steps.find(step => step.name === 'Install selected gate browsers');
    expect(install.env.BROWSERS).toBe('${{ steps.gate-browsers.outputs.browsers }}');
    expect(install.run).toContain('"$BROWSERS" != chromium');
    expect(install.run).toContain('npx playwright install "${deps[@]}" "${selected_engines[@]}"');
    // Only Firefox/WebKit ever run apt, and from cached .debs; a Chromium cache miss is a download.
    expect(install.run).not.toMatch(/CACHE_HIT" != true[^\n]*\n\s*deps\+=/);
    const debs = jobs.gates.steps.find((step) => step.with?.path === '~/browser-debs');
    expect(debs.if).toBe("steps.gate-browsers.outputs.browsers != 'chromium'");
    expect(jobs.gates.steps.indexOf(debs)).toBeLessThan(jobs.gates.steps.indexOf(install));
    for (const job of ['api', 'node']) {
      for (const step of jobs[job].steps) expect(step.run ?? '', job).not.toContain('--with-deps');
    }
    // Main fills the caches PRs read, and nothing waits for it.
    expect(jobs['warm-caches'].if).toBe("github.event_name != 'pull_request'");
    expect(jobs['warm-caches'].needs).toBeUndefined();
    expect(jobs.test.needs).not.toContain('warm-caches');
    const warmKeys = jobs['warm-caches'].steps.filter((step) => step.uses?.startsWith('actions/cache@')).map((step) => step.with.key);
    for (const restore of [debs, jobs.gates.steps.find((step) => step.id === 'browser-chromium'), jobs.gates.steps.find((step) => step.id === 'build-cache')]) {
      expect(warmKeys).toContain(restore.with.key);
    }
    // No gate starts its own PostgreSQL (its leg is services/app/lib/datasets/__tests__/postgres-routes.test.ts),
    // so no gate shard pulls the image.
    expect(jobs.gates.steps.filter((step) => /docker pull postgres/.test(step.run ?? ''))).toEqual([]);

    const names = gateNamesOnDisk(readdirSync(path.join(root, 'scripts/gates')));
    const heaviest = (count) => Math.max(...Array.from({ length: count }, (_, offset) =>
      shardOf(names, { index: offset + 1, total: count }, shardWeight, CI_SHARD_OPTIONS).reduce((sum, name) => sum + shardWeight(name), 0)));
    expect(heaviest(CI_GATE_SHARDS)).toBeLessThanOrEqual(heaviest(CI_GATE_SHARDS - 1));
    // Every shard fits its wall: two servers halve its summed seconds, but the clipboard group runs
    // one gate at a time across both, so it is charged whole — and so is the isolated gates' shard,
    // which runs on one server (scripts/gates.servers.mjs `serversFor`).
    for (let index = 1; index <= CI_GATE_SHARDS; index++) {
      const shard = shardOf(names, { index, total: CI_GATE_SHARDS }, shardWeight, CI_SHARD_OPTIONS);
      const seconds = shard.reduce((sum, name) => sum + specFor(name).seconds, 0);
      const serial = shard.filter((name) => specFor(name).serialGroup === 'clipboard').reduce((sum, name) => sum + specFor(name).seconds, 0);
      const servers = shard.every((name) => CI_ISOLATED_GATES.includes(name)) ? 1 : 2;
      expect(Math.max(seconds / servers, serial), `shard ${index}: ${shard.join(',')}`).toBeLessThanOrEqual(75);
    }

    const sessions = jobs.gates.steps.find((step) => step.name === 'Prepare isolated browser session workers');
    expect(sessions.run).toContain('sudo apt-get install -y bubblewrap ||');
  });

  it('reports every job duration and enforces timing on the complete required chain', () => {
    const { jobs } = ci();
    // Folded into the roll-up (`test`), which already waits on every job that does work: one runner and
    // one setup fewer than the separate `job timings` job it was. Not `notify-consumer` (it waits on
    // `test`), and not `warm-caches`: waiting on it would put a 15-minute job on merge → production.
    expect(jobs).not.toHaveProperty('timings');
    // Nor `supersede`: it cancels a PR's EARLIER runs, and nothing in this run may wait for it.
    const named = Object.keys(jobs).filter((job) => !['test', 'notify-consumer', 'warm-caches', 'supersede'].includes(job));
    expect(jobs.test.needs).not.toContain('supersede');
    expect(jobs.test.needs).not.toContain('notify-consumer');
    expect(jobs.test.needs).not.toContain('warm-caches');
    expect(jobs.test.needs).toEqual(expect.arrayContaining(named));
    expect(jobs.test.if).toBe("always()");
    const step = jobs.test.steps.find((candidate) => (candidate.run ?? '').includes('/actions/runs/'));
    expect(step.if).toBe('always()');
    // Per-job durations are diagnostics on both PRs and main; the chain owns timing failures.
    expect(step['continue-on-error']).toBe(true);
    // Reading the run's own job list needs a scope the workflow does not grant by default.
    expect(jobs.test.permissions.actions).toBe('read');
    expect(jobs.test.permissions.contents).toBe('read');
    const report = step.run;
    expect(report).toContain('GITHUB_STEP_SUMMARY');
    expect(report).toContain('/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs');
    expect(report).not.toContain('exit 1');
    expect(report).toContain('::warning::');
    // The roll-up is still running while it reads the list; it does not measure itself.
    expect(report).toContain('select(.name != "test")');
    // The slowest STEP is named, because "gates took 300s" is not something anyone can act on.
    expect(report).toContain('.steps[]');
    expect(Number(step.env.BUDGET_S)).toBeLessThanOrEqual(240);
    // Diagnostics follow functional checks. The complete chain gate runs before evidence is recorded.
    const at = (text) => jobs.test.steps.findIndex((candidate) => (candidate.run ?? '').includes(text));
    expect(jobs.test.steps.indexOf(step)).toBeGreaterThan(at('scripts/ci/ci.mjs check'));
    expect(jobs.test.steps.indexOf(step)).toBeLessThan(at('scripts/ci/ci.mjs record-tree'));
    expect(at('scripts/lib/ci-elapsed.mjs')).toBeLessThan(at('scripts/ci/ci.mjs record-tree'));
    // Never a job of its own in the planner's list.
    expect(CI_JOBS).not.toContain('timings');
  });

  it('lints the workflows where a typo is cheap to find', () => {
    const lint = ci().jobs.checks.steps.find((step) => (step.run ?? '').includes('actionlint'));
    expect(lint, 'checks runs actionlint').toBeDefined();
    expect(lint.run).toMatch(/actionlint:\d+\.\d+\.\d+/);
  });

  it('records the tested tree from the roll-up, and lets a push find it', () => {
    const { jobs } = ci();
    // Reading the artifact list of another run is a scope; a job-level block REPLACES the workflow's.
    expect(jobs.plan.permissions.actions).toBe('read');
    expect(jobs.plan.outputs['source-run']).toBe('${{ steps.select.outputs.source-run }}');
    const record = jobs.test.steps.find((step) => (step.run ?? '').includes('scripts/ci/ci.mjs record-tree'));
    expect(record.id).toBe('tree');
    // Only after the roll-up said every selected job was green.
    expect(jobs.test.steps.indexOf(record)).toBeGreaterThan(jobs.test.steps.findIndex((step) => (step.run ?? '').includes('scripts/ci/ci.mjs check')));
    const tree = jobs.test.steps.find((step) => (step.with?.name ?? '').startsWith('tested-tree-'));
    expect(tree.with.name).toBe('tested-tree-${{ steps.tree.outputs.tree }}');
    expect(jobs.test.steps.find((step) => step.with?.name === 'tested-run')).toBeUndefined();
    // The patch a moved-base push can still recognise (scripts/ci/ci.mjs `patchGapIsSafe`) needs the
    // PR's own base and full history to diff against it — a shallow, single-commit checkout has neither.
    expect(record.env.CI__EVENT).toBe('${{ github.event_name }}');
    expect(record.env.CI__BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
    const checkout = jobs.test.steps.find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout.with['fetch-depth']).toBe(2);
    const patch = jobs.test.steps.find((step) => (step.with?.name ?? '').startsWith('tested-patch-'));
    expect(patch.if).toBe("steps.tree.outputs.patch-id != ''");
    expect(patch.with.name).toBe('tested-patch-${{ steps.tree.outputs.patch-id }}');
    expect(jobs.test.steps.indexOf(patch)).toBeGreaterThan(jobs.test.steps.indexOf(record));
  });
});

describe('the build cache key covers every build input and nothing a build cannot read', () => {
  it('leaves out tests, gates, workflows and prose, and keeps sources, skills and the lockfile', () => {
    for (const path of ['services/app/lib/story-ui/parse.ts', 'services/app/skills/artifactbin/SKILL.md', 'scripts/build/build-islands.mjs',
      'scripts/build/build-server.mjs', 'package-lock.json', 'vite.config.mts', 'services/app/public/chat/install.sh']) {
      expect(isBuildInput(path), path).toBe(true);
    }
    for (const path of ['services/app/__tests__/boot-env.test.ts', 'services/app/lib/islands/__tests__/one-tree.ui.test.ts',
      'scripts/gates/gate-editor-engine.mjs', 'scripts/gates.manifest.mjs', '.github/workflows/ci.yml', 'docs/agent-workflows.md', 'README.md',
      'scripts/ci/test-timings.json', 'scripts/ci/test-timings.mjs', 'scripts/lib/timed-sequencer.mjs']) {
      expect(isBuildInput(path), path).toBe(false);
    }
  });
  it('prints a key that only a build input moves', () => {
    const key = () => /build key ([0-9a-f]{32})/.exec(execFileSync(process.execPath, [path.join(root, 'scripts/ci/ci.mjs'), 'build-key'], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } }))?.[1];
    expect(key()).toMatch(/^[0-9a-f]{32}$/);
    expect(key()).toBe(key());
  });
});


it('records the same exact merge tree and patch from the rollup checkout depth', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'ci-shallow-rollup-'));
  const source = path.join(rootDir, 'source');
  mkdirSync(source);
  const git = (...args) => execFileSync('git', args, {cwd: source, encoding: 'utf8'}).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'mxmx_test_ci@example.com');
    writeFileSync(path.join(source, 'file.txt'), 'base');
    git('add', '.'); git('commit', '-q', '-m', 'initial');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(source, 'feature.txt'), 'feature');
    git('add', '.'); git('commit', '-q', '-m', 'feature');
    git('checkout', '-q', 'main');
    writeFileSync(path.join(source, 'main.txt'), 'independent main change');
    git('add', '.'); git('commit', '-q', '-m', 'main advances');
    const base = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', '-q', '-m', 'synthetic PR merge', 'feature');
    const head = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    const diff = git('diff', '--no-renames', `${base}...HEAD`);
    const patchId = execFileSync('git', ['patch-id', '--stable'], {input: diff, encoding: 'utf8'}).trim().split(/\s+/)[0];
    const jobs = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')).jobs;
    const depth = jobs.test.steps.find(step => step.uses?.startsWith('actions/checkout')).with['fetch-depth'];
    expect(depth).toBe(2);
    const clone = path.join(rootDir, 'clone');
    execFileSync('git', ['clone', '-q', '--depth', String(depth), pathToFileURL(source).href, clone]);
    expect(execFileSync('git', ['rev-parse', '--is-shallow-repository'], {cwd: clone, encoding: 'utf8'}).trim()).toBe('true');
    const output = path.join(rootDir, 'output');
    execFileSync(process.execPath, [script, 'record-tree'], {cwd: clone, encoding: 'utf8', env: {...process.env, GITHUB_RUN_ID: '373', GITHUB_SHA: head, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', CI__SOURCE_RUN: '373', CI__EVENT: 'pull_request', CI__BASE_SHA: base}});
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean)
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    expect(outputs).toMatchObject({tree, 'patch-id': patchId});
    expect(JSON.parse(readFileSync(path.join(clone, 'tested-tree/tested-tree.json'), 'utf8'))).toEqual({run_id: 373, head_sha: head, tree});
    expect(JSON.parse(readFileSync(path.join(clone, 'tested-patch/tested-patch.json'), 'utf8'))).toEqual({run_id: 373, base});
  } finally { rmSync(rootDir, {recursive: true, force: true}); }
});
