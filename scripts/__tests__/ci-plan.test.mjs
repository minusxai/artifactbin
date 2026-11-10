import { describe, expect, it } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { createServer } from 'node:http';
import { CI_JOBS, checkCiResults, isBuildInput, planCi, testBuildsKey } from '../lib/ci-plan.mjs';
import { MODULE_CACHE_DIR, SCHEMA_IMAGE_DIR } from '../lib/suite-env.mjs';
import { CI_GATE_SHARDS, CI_ISOLATED_GATES, CI_SHARD_OPTIONS, gateNamesOnDisk, shardWeight, specFor } from '../gates.manifest.mjs';
import { shardOf } from '../gates.shard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts/ci/ci.mjs');

describe('a tree is tested once', () => {
  it('selects no job at all — not even checks — when a green run already tested this tree', () => {
    const plan = planCi({ testedRun: '4242' });
    expect(Object.values(plan.jobs).some(Boolean), 'every job is skipped').toBe(false);
    expect(plan.testedRun).toBe('4242');
    // And the roll-up must accept that: every selected job (there are none) succeeded.
    expect(checkCiResults(plan, Object.fromEntries(CI_JOBS.map((job) => [job, 'skipped'])))).toEqual([]);
  });

  it('selects every job when nothing tested this tree', () => {
    expect(planCi({ testedRun: null }).jobs).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, true])));
  });
});

describe('GitHub CI adapter', () => {
  /** A repository with the app module and a lockfile. */
  const repositoryFixture = (cwd) => {
    mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
    writeFileSync(path.join(cwd, 'package-lock.json'), '{\n  "packages": {}\n}\n');
  };

  const readOutputs = (output) => Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

  /** The planner's outputs, without blocking this process: a test that SERVES the planner's API call
   * must not hold the event loop while the planner waits on it. */
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
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'an ordinary merge');
      const head = git('rev-parse', 'HEAD');
      const tree = git('rev-parse', 'HEAD^{tree}');
      const env = {
        CI__EVENT: 'push', CI__HEAD_SHA: head,
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
      // A manual run never reuses: it was asked for so that it runs.
      answer = { status: 200, body: { artifacts: [{ id: 7, expired: false, workflow_run: { id: 4242 } }] } };
      expect((await planOutputServed(cwd, { ...env, CI__EVENT: 'workflow_dispatch' })).api).toBe('true');
    } finally {
      api.close();
      rmSync(cwd, { recursive: true, force: true });
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

  it('invalidates the install fingerprint on installed and generated inputs only', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-install-inputs-'));
    const put = (file, text) => {
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      writeFileSync(path.join(cwd, file), text);
    };
    const fingerprint = () => {
      execFileSync(process.execPath, [script, 'lock-fingerprint'], { cwd });
      return readFileSync(path.join(cwd, '.ci-cache-key/install.json'), 'utf8');
    };
    try {
      put('package-lock.json', JSON.stringify({ packages: { '': {}, 'services/app': {} } }));
      for (const file of ['services/app/scripts/copy-assets.mjs', 'services/app/scripts/system-font-packages.mjs',
        'package.json', 'services/app/package.json', '.npmrc']) {
        put(file, file.endsWith('package.json') ? '{"version":"1.0.0","scripts":{"postinstall":"first"}}' : 'first');
        const before = fingerprint();
        put(file, file.endsWith('package.json') ? '{"version":"1.0.0","scripts":{"postinstall":"second"}}' : 'second');
        expect(fingerprint(), file).not.toBe(before);
      }
      const before = fingerprint();
      for (const file of ['design-systems/fonts.json', 'design-systems/font-assets/example.woff2',
        'design-systems/lib/font-assets.mjs', 'README.md']) put(file, 'unused by postinstall');
      expect(fingerprint()).toBe(before);
      put('services/app/package.json', '{"version":"2.0.0","scripts":{"postinstall":"second"}}');
      expect(fingerprint()).toBe(before);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('runs the roll-up from GitHub-shaped results and refuses planner failure', () => {
    const plan = planCi();
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
    // ci.yml runs after a merge only (scripts/__tests__/v3-ci.test.mjs): no pull request run to supersede.
    expect(jobs).not.toHaveProperty('supersede');
  });
});

describe('required CI result', () => {
  const plan = () => planCi();
  const results = (p) => Object.fromEntries(CI_JOBS.map((j) => [j, p.jobs[j] ? 'success' : 'skipped']));

  it('accepts intentional skips and successful selected jobs', () => {
    for (const p of [plan(), planCi({ testedRun: '4242' })]) expect(checkCiResults(p, results(p))).toEqual([]);
  });
  it('rejects failures, cancellation, missing results and unexpectedly skipped selected jobs', () => {
    const p = plan();
    for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
      expect(checkCiResults(p, { ...results(p), gates: status })).toContain('gates');
    }
    expect(checkCiResults(p, { ...results(p), api: 'failure' })).toContain('api');
  });
});

describe('CI avoids duplicate integration setup', () => {
  it('runs both ends of the chain, plan and roll-up, on the runner\'s own Node with builtin-only scripts', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    for (const job of ['plan', 'test']) {
      expect(jobs[job].steps.filter(step => step.uses?.startsWith('actions/setup-node@')), job).toEqual([]);
      expect(jobs[job].steps.filter(step => /\bnpm (ci|install)\b/.test(step.run ?? '')), job).toEqual([]);
    }
    const scripts = [...new Set(['plan', 'test'].flatMap(job => jobs[job].steps.flatMap(step => [...(step.run ?? '').matchAll(/node (scripts\/\S+\.mjs)/g)].map(match => match[1]))))];
    expect(scripts).toEqual(expect.arrayContaining(['scripts/ci/ci.mjs', 'scripts/lib/ci-elapsed.mjs']));
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
  it('provisions Chromium, Postgres and MySQL only for the integration project, in its own job beside the node shards', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    // No api or api-isolated file launches Chromium (the whole project passes without a browser installed), so the api
    // shards provision none either.
    for (const job of ['node', 'api']) expect(jobs[job].steps.filter(step => step.id === 'playwright' || /playwright|docker pull|test:integration/.test(step.run ?? '')), job).toEqual([]);
    const steps = jobs.integration.steps;
    expect(jobs.integration.needs).toEqual(['plan']);
    expect(jobs.integration.if).toBe("needs.plan.outputs.integration == 'true'");
    const run = steps.findIndex(step => step.run === 'npm run test:integration');
    for (const provision of [step => step.id === 'playwright', step => step.run === 'npx playwright install chromium', step => step.run === 'docker pull postgres:17-alpine', step => step.run === 'docker pull mysql:8']) {
      const at = steps.findIndex(provision);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(run);
    }
  });
  it('leaves every node shard to Vitest alone: no shard is preloaded with other work', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.steps.filter(step => step.if?.includes('matrix.shard'))).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(root, 'scripts/ci/test-timings.json'), 'utf8')).reserve).toBeUndefined();
  });
  it('splits the node project into six shards, and every shard runs its sixth', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6]);
    expect(jobs.node.name).toBe('node tests (${{ matrix.shard }}/6)');
    expect(jobs.node.steps.find(step => (step.run ?? '').startsWith('node scripts/ci/ci.mjs node')).run).toBe('node scripts/ci/ci.mjs node ${{ matrix.shard }}/6');
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
      expect(steps[restore].with.path).toContain('services/app/lib/build-assets');
    }
    expect(jobs['warm-caches'].steps.some(step => (step.uses ?? '').startsWith('actions/cache/save') && step.with.key.startsWith('test-builds-v2-'))).toBe(true);
  });
  // Only a Vitest worker builds the schema image, and only main's cache entries reach every pull request: warm-caches
  // must boot a database before it saves the entry, or no pull request ever restores an image.
  it('builds the test database\'s schema image on main before saving the test builds', () => {
    const steps = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')).jobs['warm-caches'].steps;
    const image = steps.findIndex(step => step.run === 'node node_modules/vitest/vitest.mjs run --project=api services/app/__tests__/schema-image.test.ts');
    const save = steps.findIndex(step => (step.uses ?? '').startsWith('actions/cache/save') && step.with.key.startsWith('test-builds-v2-'));
    expect(image).toBeGreaterThan(-1);
    expect(image).toBeLessThan(save);
    const modules = steps.findIndex(step => /^node node_modules\/vitest\/vitest\.mjs list --project=api --project=api-isolated\b/.test(step.run ?? ''));
    expect(modules).toBeGreaterThan(-1);
    expect(modules).toBeLessThan(save);
    expect(readFileSync(path.join(root, 'services/app/__tests__/schema-image.test.ts'), 'utf8')).toContain("inject('schemaImageDir')");
  });
  // The server-reader marker lists the hosted libraries as outputs: an entry without them is a miss on every shard,
  // which rebuilt both (~10s) at the start of every api, node, ui and integration shard (run 42349357334).
  it('caches the test builds whole, under the key of what they are built from, in every workflow that reads them', () => {
    const steps = ['ci.yml', 'pr-fast.yml'].flatMap(file => Object.entries(yaml.parse(readFileSync(path.join(root, '.github/workflows', file), 'utf8')).jobs)
      .map(([name, job]) => [`${file} ${name}`, job.steps]));
    let entries = 0;
    for (const [name, jobSteps] of steps) {
      const caches = jobSteps.filter(step => String(step.with?.key ?? '').startsWith('test-builds-'));
      for (const cache of caches) {
        entries++;
        expect(cache.with.path.split('\n').filter(Boolean), name).toEqual(['services/app/lib/build-assets', 'services/app/public/libraries', SCHEMA_IMAGE_DIR, MODULE_CACHE_DIR]);
        expect(cache.with.key, name).toBe('test-builds-v2-${{ runner.os }}-${{ steps.test-builds-key.outputs.key }}');
        if (cache.with['restore-keys'] !== undefined) expect(cache.with['restore-keys'], name).toBe('test-builds-v2-${{ runner.os }}-');
        const key = jobSteps.findIndex(step => step.id === 'test-builds-key');
        expect(key, name).toBeGreaterThan(-1);
        expect(key, name).toBeLessThan(jobSteps.indexOf(cache));
        expect(jobSteps[key].run, name).toBe('node scripts/ci/ci.mjs test-builds-key');
      }
    }
    expect(entries).toBeGreaterThanOrEqual(10);
  });
  it('keys the test builds on their own inputs, so a change elsewhere keeps the entry and one here moves it', () => {
    const line = (file, id = 'a'.repeat(40)) => `100644 ${id} 0\t${file}`;
    const base = ['services/app/lib/html-components/tabs.ts', 'services/contracts/src/index.ts', 'services/app/lib/libraries/registry.json',
      'services/app/scripts/build-libraries.mjs', 'scripts/lib/html-components-build.mjs', 'package-lock.json', 'services/app/server/app.ts',
      'services/app/lib/html-components/__tests__/tabs.test.ts', 'services/app/lib/platform/schema.ts', 'services/runner/src/schema.ts',
      'services/app/lib/platform/__tests__/config.test.ts'].map(file => line(file)).join('\n');
    const { key, inputs } = testBuildsKey(base);
    expect(inputs).toBe(8);
    // Outside the inputs (server code, tests): the same key.
    expect(testBuildsKey(base.replace(line('services/app/server/app.ts'), line('services/app/server/app.ts', 'b'.repeat(40)))).key).toBe(key);
    expect(testBuildsKey(base.replace(line('services/app/lib/html-components/__tests__/tabs.test.ts'), line('services/app/lib/html-components/__tests__/tabs.test.ts', 'b'.repeat(40)))).key).toBe(key);
    // A component, a contract, a library, a build tool, or the schema the cached schema image is built from: a new key.
    for (const file of ['services/app/lib/html-components/tabs.ts', 'services/contracts/src/index.ts', 'services/app/lib/libraries/registry.json', 'services/app/scripts/build-libraries.mjs', 'package-lock.json', 'services/app/lib/platform/schema.ts', 'services/runner/src/schema.ts']) {
      expect(testBuildsKey(base.replace(line(file), line(file, 'c'.repeat(40)))).key, file).not.toBe(key);
    }
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
        expect(cache.with.path).toContain('services/app/lib/html-systems/font-manifest.json');
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
    expect(jobs['warm-caches'].if).toBeUndefined();
    expect(jobs['warm-caches'].needs).toBeUndefined();
    expect(jobs.test.needs).not.toContain('warm-caches');
    const warmKeys = jobs['warm-caches'].steps.filter((step) => step.uses?.startsWith('actions/cache@')).map((step) => step.with.key);
    for (const restore of [debs, jobs.gates.steps.find((step) => step.id === 'browser-chromium'), jobs.gates.steps.find((step) => step.id === 'build-cache')]) {
      expect(warmKeys).toContain(restore.with.key);
    }
    // No gate starts its own PostgreSQL,
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
    const named = Object.keys(jobs).filter((job) => !['test', 'notify-consumer', 'warm-caches'].includes(job));
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
  });
});

describe('the build cache key covers every build input and nothing a build cannot read', () => {
  it('leaves out tests, gates, workflows and prose, and keeps sources, skills and the lockfile', () => {
    for (const path of ['services/app/lib/html-components/markdown.ts', 'services/app/skills/artifactbin/SKILL.md', 'services/app/scripts/build-server-reader.mjs',
      'scripts/build/build-server.mjs', 'package-lock.json', 'vite.config.mts', 'services/app/public/favicon.ico']) {
      expect(isBuildInput(path), path).toBe(true);
    }
    for (const path of ['services/app/__tests__/boot-env.test.ts', 'services/app/solid/document/__tests__/framed-nodes.test.ts',
      'scripts/gates/gate-editor-engine.mjs', 'scripts/gates.manifest.mjs', '.github/workflows/ci.yml', 'SETUP.md', 'README.md',
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
