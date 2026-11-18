/** CI job-ownership contracts and immutable maintenance action pins. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'yaml';
import { describe, expect, it, onTestFinished } from 'vitest';
import { baseCommit, chooseBaseRun, triggerPaths } from '../ci/page-speed-base.mjs';
import { isRelevant, touchesLab } from '../ci/page-speed-scope.mjs';
import {tempDirSync} from '../../services/test-support/src/temp-dir.ts';

const root = path.resolve(import.meta.dirname, '../..');
const ciPath = path.join(root, '.github', 'workflows', 'ci.yml');
const ci = yaml.parse(readFileSync(ciPath, 'utf8'));

describe('the public repository boundary', () => {
  it('contains no proprietary deployment identifiers in any tracked source file', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
    const markers = [['artifactbin', 'prod'].join('-'), ['afbin', 'prod'].join('_')];
    const leaks = files.flatMap((file) => {
      const full = path.join(root, file);
      let text = ''; try { text = readFileSync(full, 'utf8'); } catch { return []; }
      return markers.filter((marker) => text.includes(marker)).map((marker) => `${file}: ${marker}`);
    });
    expect(leaks).toEqual([]);
  });
});

const checkoutStep = () => yaml.parse(readFileSync(path.join(root, '.github/workflows/pr-fast.yml'), 'utf8')).jobs.fast.steps.find((step) => step.id === 'checkout');

/** Runs pr fast's checkout step in an empty workspace against a local origin whose HEAD is one commit past the target. */
function runCheckout({ stallFirst = false, failAll = false, attempts = checkoutStep().env.CHECKOUT_ATTEMPTS } = {}) {
  const base = tempDirSync('afbin-checkout-',onTestFinished);
  const origin = path.join(base, 'server', 'o', 'r'), work = path.join(base, 'work'), temp = path.join(base, 'temp');
  const release = path.join(base, 'release'), calls = path.join(base, 'fetches');
  for (const dir of [origin, work, temp]) mkdirSync(dir, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: base, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const inOrigin = (...args) => execFileSync('git', ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { env, encoding: 'utf8' }).trim();
  const commit = (file) => { writeFileSync(path.join(origin, file), `${file[0]}\n`); inOrigin('add', file); inOrigin('commit', '-qm', file); return inOrigin('rev-parse', 'HEAD'); };
  let target = '0'.repeat(40);
  if (!failAll) { inOrigin('init', '-q'); commit('root.txt'); target = commit('a.txt'); commit('b.txt'); }
  const token = 'test-token-not-a-credential';
  // The stalled attempt blocks, and leaves a detached grandchild holding whatever streams it was given: had the step not
  // redirected them, that grandchild would hold this spawn open to its timeout, as the runner holds a step open.
  const hold = `while [ -d '${base}' ] && [ ! -e '${release}' ]; do sleep 0.05; done`;
  const shim = `git(){ case "$*" in *" fetch "*) printf 'x\\n' >> '${calls}';; esac
  case "$*" in *checkout-1" "*" fetch "*) if ${stallFirst}; then ( ( ${hold} ) & ); ${hold}; return 1; fi;; esac
  case "$*" in *" fetch "*) if ${failAll}; then echo 'fatal: unable to access' >&2; return 128; fi;; esac
  command git "$@"; }`;
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', `${shim}\n${checkoutStep().run}`], {
    cwd: work, encoding: 'utf8', timeout: 20000,
    env: { ...env, GH_TOKEN: token, GITHUB_SERVER_URL: `file://${path.join(base, 'server')}`, GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: target, GITHUB_REF: 'refs/pull/7/merge', RUNNER_TEMP: temp, CHECKOUT_HEDGE_TICKS: '1', CHECKOUT_ATTEMPTS: String(attempts) },
  });
  const git = (...args) => {
    const options = typeof args.at(-1) === 'object' ? args.pop() : {};
    const out = spawnSync('git', ['-C', work, ...args], { env, encoding: 'utf8' });
    if (out.status !== 0 && !options.allowFail) throw new Error(`git ${args.join(' ')}: ${out.stderr}`);
    return out.stdout.trim();
  };
  const fetches = () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0);
  return { result, target, token, work, git, fetches, cleanup: () => { writeFileSync(release, ''); } };
}

describe('workflow supply-chain pins', () => {
  // One `git fetch --depth=1` took 0.9s median and 1.8s p99 over 587 pr fast jobs, and 15-63s three times (runs
  // 44141023943-44148017273), with the low-speed abort never firing. The checkout hedges it: a second attempt starts
  // beside one that has not landed, and the first to land is checked out. These run the step's own shell (bash -e, as
  // Actions runs it) against a local origin, with `git fetch` stubbed only where an attempt must stall or fail.
  it('checks out this exact revision from the attempt that lands while a stalled one still holds its streams open', () => {
    const run = runCheckout({ stallFirst: true });
    try {
      expect(run.result.error, 'a stalled attempt held the step open').toBeUndefined();
      expect(run.result.status, run.result.stderr).toBe(0);
      // A later attempt won: on a loaded machine a third may have started before the second landed, never the stalled first.
      expect(run.result.stdout).toMatch(/from attempt [2-9] of [2-9]\n/);
      expect(run.git('rev-parse', 'HEAD')).toBe(run.target);
      expect(run.git('rev-parse', 'refs/remotes/pull/7/merge')).toBe(run.target);
      expect(run.git('symbolic-ref', '-q', 'HEAD', { allowFail: true })).toBe('');
      expect(run.git('rev-list', '--count', 'HEAD')).toBe('1');
      expect(run.git('status', '--porcelain')).toBe('');
      expect(readFileSync(path.join(run.work, 'a.txt'), 'utf8')).toBe('a\n');
      expect(existsSync(path.join(run.work, 'b.txt'))).toBe(false);
      // The token reached git through its environment alone: nothing of it, or of an auth header, is left in the checkout.
      const config = readFileSync(path.join(run.work, '.git', 'config'), 'utf8');
      for (const secret of [run.token, Buffer.from(`x-access-token:${run.token}`).toString('base64'), 'extraheader']) expect(config).not.toContain(secret);
    } finally { run.cleanup(); }
  });
  it('starts the next attempt at once when one fails, and fails the step only when every attempt has failed', () => {
    const run = runCheckout({ failAll: true, attempts: 2 });
    try {
      expect(run.result.error).toBeUndefined();
      expect(run.result.status).not.toBe(0);
      expect(run.result.stdout).toContain('::error::');
      expect(run.fetches()).toBe(2);
      expect(existsSync(path.join(run.work, '.git'))).toBe(false);
    } finally { run.cleanup(); }
  });
  it('replaces actions/checkout as the step after the Node probe, bounding idle transfers and fetching the run\'s own sha', () => {
    const fast = yaml.parse(readFileSync(path.join(root, '.github/workflows/pr-fast.yml'), 'utf8'));
    const steps = fast.jobs.fast.steps;
    expect(steps.filter((step) => step.uses?.startsWith('actions/checkout@'))).toEqual([]);
    const checkout = steps[1];
    expect(checkout.id).toBe('checkout');
    expect(checkout.env).toMatchObject({ GH_TOKEN: '${{ github.token }}', GIT_HTTP_LOW_SPEED_LIMIT: '1024', GIT_HTTP_LOW_SPEED_TIME: '10' });
    // Hedged after 3s: past every one of the 587 fetches measured but the three stalls (p99 1.8s, then 2.0s).
    expect(checkout.env.CHECKOUT_HEDGE_TICKS).toBe('30');
    expect(Number(checkout.env.CHECKOUT_ATTEMPTS)).toBeGreaterThanOrEqual(3);
    expect(checkout['continue-on-error']).not.toBe(true);
    expect(checkout.run).toContain('--depth=1 "$url" "+$GITHUB_SHA:$ref"');
  });
  it('uses immutable full commit SHAs for every third-party action', () => {
    for (const file of ['ci.yml', 'pr-fast.yml', 'v3-codeql.yml', 'page-speed.yml']) {
      const text = readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      const refs = [...text.matchAll(/uses:\s+([^\s#]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
      expect(refs.length, file).toBeGreaterThan(0);
      for (const ref of refs) expect(ref, `${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('dependency security', () => {
  // Monaco carried its own DOMPurify, which had to be pinned outside an
  // advisory range; it must not come back in.
  it('ships no Monaco', () => {
    const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    for (const file of ['package.json', 'services/app/package.json']) {
      for (const field of ['dependencies', 'devDependencies']) {
        for (const pkg of ['monaco-editor', '@monaco-editor/react']) expect(read(file)[field]?.[pkg], `${file} ${field}`).toBeUndefined();
      }
    }
  });
});

/**
 * NO COMPOSE JOB HERE, AND NO IMAGE JOB EITHER. The container distribution was retired with its
 * Dockerfile and compose file, and split-deployment CI belongs to the production server repository.
 */
describe('OSS single-host ownership', () => {
  it('builds no container and leaves split deployment CI to production', () => {
    expect(ci.jobs.gates).toBeDefined();
    expect(ci.jobs).not.toHaveProperty('image');
    expect(ci.jobs).not.toHaveProperty('compose');
    expect(ci.jobs.plan.outputs).not.toHaveProperty('image');
    expect(ci.jobs.plan.outputs).not.toHaveProperty('compose');
    expect(ci.jobs.test.needs).not.toContain('image');
    expect(ci.jobs.test.needs).not.toContain('compose');
    expect(readFileSync(ciPath, 'utf8')).not.toContain('docker/build-push-action');
    for (const file of ['Dockerfile', 'docker-compose.yml']) {
      expect(existsSync(path.join(root, file)), `${file} is retired`).toBe(false);
    }
  });
});

/**
 * NO GATE WAITS FOR THE `build` JOB. The shards used to poll it and download its artifact.
 * Each shard now builds what it runs, in the background while it provisions browsers.
 */
describe('ci.yml: the gates build what they run, off the build job', () => {
  it('starts the gate build in the background and waits on it, never on `build`', () => {
    expect(ci.jobs.gates.needs).toEqual(['plan']);
    const steps = ci.jobs.gates.steps;
    for (const step of steps) {
      expect(String(step.uses ?? '')).not.toMatch(/^actions\/download-artifact@/);
      expect(String(step.run ?? '')).not.toContain('.name == "build"');
    }
    expect(ci.jobs.build.steps.filter(step=>step.uses?.startsWith('actions/upload-artifact'))).toEqual([]);
    const start = steps.find((step) => step.name === 'Build the app and server in the background');
    const wait = steps.find((step) => step.name === "Wait for this shard's build");
    // Every stream redirected and the group backgrounded, or the runner holds the step open until it ends.
    expect(start?.run).toContain('node scripts/build/build-gate-inputs.mjs');
    expect(start?.run).toMatch(/< \/dev\/null > \/dev\/null 2>&1 &\s*$/);
    expect(wait?.run).toContain('gate-build.status');
    const at = (name) => steps.findIndex((step) => step.name === name);
    // Overlapped: after the install and the island restore, before every provisioning step it overlaps.
    const restore = steps.findIndex((step) => String(step.with?.key ?? '').startsWith('test-builds-v2-'));
    expect(restore).toBeGreaterThan(-1);
    expect(steps.indexOf(start)).toBeGreaterThan(restore);
    expect(steps.indexOf(start)).toBeLessThan(at('Install selected gate browsers'));
    expect(steps.indexOf(wait)).toBeGreaterThan(at('Prepare isolated browser session workers'));
    expect(steps.indexOf(wait)).toBeLessThan(at('every gate, two servers'));
    expect(steps.map((step) => step.run)).not.toContain('npm run build');
    // A build of these exact sources already cached skips building: the shard restores the entry
    // `build` saved, under the same key and paths, and never writes one itself.
    const save = ci.jobs.build.steps.find((step) => step.id === 'build-cache');
    const cached = steps.find((step) => step.id === 'build-cache');
    expect(save?.uses).toMatch(/^actions\/cache@/);
    expect(cached?.uses).toMatch(/^actions\/cache\/restore@/);
    expect(cached.with).toEqual(save.with);
    expect(save.with['restore-keys']).toBeUndefined();
    expect(save.with.key).toContain('steps.build-key.outputs.key');
    for (const job of [ci.jobs.build, ci.jobs.gates]) {
      expect(job.steps.find((step) => step.id === 'build-key')?.run).toBe('node scripts/ci/ci.mjs build-key');
    }
    const miss = "steps.build-cache.outputs.cache-hit != 'true'";
    expect(start.if).toBe(miss);
    expect(wait.if).toBe(miss);
    expect(ci.jobs.build.steps.find((step) => step.run === 'npm run build')?.if).toBe(miss);
    // Every Chromium cache keys on what pins the browser, never on the whole lockfile.
    for (const [name, job] of Object.entries(ci.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.with?.path === '~/.cache/ms-playwright') expect(step.with.key, name).toContain("hashFiles('node_modules/playwright-core/browsers.json')");
      }
    }
  });
  it('builds the gate inputs with the root build, which bundles the app and the gate server', () => {
    const source = readFileSync(path.join(root, 'scripts/build/build-gate-inputs.mjs'), 'utf8');
    expect(source).toContain("execFileSync('npm', ['run', 'build']");
    const root_ = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(root_.scripts.build).toContain('node scripts/build/build-server.mjs dist/server.mjs');
    expect(ci.jobs.build.steps.filter((step) => step.run === 'npm run build')).toHaveLength(1);
  });
});

const workflow = (file) => yaml.parse(readFileSync(path.join(root, '.github/workflows', file), 'utf8'));

describe('code scanning runs after merge, not on every pull request', () => {
  it('analyses JavaScript/TypeScript and Actions on each push to main and weekly, never on a pull request', () => {
    const codeql = workflow('v3-codeql.yml');
    expect(codeql.on).not.toHaveProperty('pull_request');
    expect(codeql.on.push.branches).toEqual(['main']);
    // The weekly rescan of an unchanged main against new query packs.
    expect(codeql.on.schedule).toEqual([{ cron: '23 6 * * 1' }]);
    expect(codeql.on).toHaveProperty('workflow_dispatch');
    const analyze = codeql.jobs.analyze;
    expect(analyze.strategy.matrix.language).toEqual(['actions', 'javascript-typescript']);
    expect(analyze.permissions['security-events']).toBe('write');
    const uses = analyze.steps.map((step) => step.uses ?? '');
    expect(uses.some((use) => use.startsWith('github/codeql-action/init@'))).toBe(true);
    expect(uses.some((use) => use.startsWith('github/codeql-action/analyze@'))).toBe(true);
    expect(existsSync(path.join(root, '.github/workflows/codeql.yml'))).toBe(false);
  });
});

describe('CodeQL leaves one overlay database in the cache, not one per merge', () => {
  // Each push scan saves a ~405 MB overlay base database under a key naming its revision; only the newest is ever
  // restored. Nineteen of them filled 7.5 GB of the repository's 10 GB on 2026-11-10, where GitHub starts evicting
  // the least recently used entries, the install cache among them.
  it('prunes every older database after the scan, keeping the newest per language', () => {
    const prune = workflow('v3-codeql.yml').jobs['prune-caches'];
    expect(prune.needs).toEqual(['analyze']);
    expect(prune.if).toBe('always()');
    expect(prune.permissions).toEqual({ actions: 'write' });
    // Deployment admission reads this workflow's result: housekeeping never fails it.
    expect(prune['continue-on-error']).toBe(true);
    const script = prune.steps.map((step) => step.run ?? '').join('\n');
    expect(script).toContain('--key codeql-overlay-base-database-');
    expect(script).toContain('--ref refs/heads/main');
    expect(script).toMatch(/group_by\(.*lang\)/);
    expect(script).toContain('.[1:]');
    expect(script).toContain('gh cache delete');
  });
});

describe('CodeQL scans every merged revision without narrowing analysis',()=>{
 // Every merged revision is a deployment candidate that needs its own scan: cancelling a superseded push scan left
 // ci-green 6e581b2eb, 08f6b19d9, 55b153ff0 and fb1c96116 unadmittable, and the replacing run sat pending 30-40 s
 // until the old one stopped (runs 41959629389, 41963771255). A push scan is grouped by its exact revision only.
 it('never cancels or queues one revision\'s push scan behind another revision\'s',()=>{
  const scan=workflow('v3-codeql.yml');
  expect(scan.concurrency['cancel-in-progress']).toBe(false);
  expect(scan.concurrency.group).toBe("${{ github.event_name == 'push' && format('{0}-push-{1}', github.workflow, github.sha) || format('{0}-{1}-{2}', github.workflow, github.ref, github.event_name) }}");
 });
 it('uploads the same complete findings while omitting optional push database archives',()=>{
  const steps=workflow('v3-codeql.yml').jobs.analyze.steps;
  const init=steps.find(step=>step.uses?.startsWith('github/codeql-action/init@'));
  const analyze=steps.find(step=>step.uses?.startsWith('github/codeql-action/analyze@'));
  expect(analyze.with['upload-database']).toBe("${{ github.event_name != 'push' }}");
  expect(analyze.with.upload??'always').toBe('always');
  expect(analyze.with['skip-queries']??'false').toBe('false');
  expect(init.with.queries).toBeUndefined();
  expect(init.with['config-file']).toBeUndefined();
  expect(init.with['config']).toBeUndefined();
 });
});

describe('page speed: the base is main\'s own measurement of the same bytes', () => {
  const speed = workflow('page-speed.yml');
  it('measures only the head beside the report, never a second build of main', () => {
    expect(Object.keys(speed.jobs).sort()).toEqual(['measure', 'report', 'scope']);
    expect(speed.jobs.measure.strategy).toBeUndefined();
    const upload = speed.jobs.measure.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
    expect(upload.with).toMatchObject({ name: 'page-speed-head', path: 'page-speed/head.json' });
    const report = speed.jobs.report;
    expect(report.permissions.actions).toBe('read');
    const find = report.steps.find((step) => step.run === 'node scripts/ci/page-speed-base.mjs');
    expect(find.id).toBe('base');
    const fromMain = report.steps.find((step) => step.with?.['run-id'] === '${{ steps.base.outputs.run-id }}');
    expect(fromMain.if).toBe("needs.scope.outputs.relevant == 'true' && steps.base.outputs.found == 'true'");
    expect(fromMain.with.name).toBe('page-speed-head');
    // The fallback measures the base only on a miss; the report and the size targets always run.
    const measure = report.steps.find((step) => step.name === 'Measure base');
    expect(measure.if).toBe("needs.scope.outputs.relevant == 'true' && steps.base.outputs.found != 'true'");
    expect(measure.run).toContain('page-speed/base.json');
    for (const name of ['Report', 'Size targets']) expect(report.steps.find((step) => step.name === name).if, name).toBe("needs.scope.outputs.relevant == 'true'");
    expect(report.steps.find((step) => step.name === 'Size targets').run).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
  // No pull_request trigger at all is 'keeps every slow suite on main' below; pull requests are filtered in the scope job.
  it('reads the push trigger paths the workflow declares; pull requests are filtered in the scope job', () => {
    const paths = triggerPaths(readFileSync(path.join(root, '.github/workflows/page-speed.yml'), 'utf8'));
    expect(paths).toEqual(speed.on.push.paths.filter(pattern => pattern !== '**'));
    expect(paths).not.toContain('**');
  });
  it('scopes a pull request by the push trigger paths and treats anything unreadable as relevant', () => {
    const paths = ['services/app/**', 'package-lock.json', '.github/workflows/page-speed.yml'];
    const pr = { EVENT: 'pull_request', PR_BASE: 'b', PR_HEAD: 'h' };
    expect(isRelevant(pr, paths, () => ['docs/a.md', 'services/sql/src/x.ts'])).toBe(false);
    expect(isRelevant(pr, paths, () => ['docs/a.md', 'services/app/lib/x.ts'])).toBe(true);
    expect(isRelevant(pr, paths, () => ['package-lock.json'])).toBe(true);
    expect(isRelevant(pr, paths, () => ['services/application/x.ts'])).toBe(false);
    expect(isRelevant(pr, paths, () => { throw new Error('no history'); })).toBe(true);
    expect(isRelevant({ EVENT: 'workflow_dispatch' }, paths, () => [])).toBe(true);
    expect(touchesLab([], paths)).toBe(false);
  });
  it('takes the newest run with the same bytes and a live artifact, else none', async () => {
    const runs = [{ id: 3, head_sha: 'c' }, { id: 2, head_sha: 'b' }, { id: 1, head_sha: 'a' }];
    const same = new Set(['b', 'a']);
    const sameBytes = (sha, base) => base === 'base' && same.has(sha);
    expect(await chooseBaseRun(runs, 'base', { sameBytes, hasArtifact: async () => true })).toEqual(runs[1]);
    expect(await chooseBaseRun(runs, 'base', { sameBytes, hasArtifact: async (id) => id === 1 })).toEqual(runs[2]);
    expect(await chooseBaseRun(runs, 'base', { sameBytes, hasArtifact: async () => false })).toBeNull();
    expect(await chooseBaseRun(runs, 'base', { sameBytes: () => false, hasArtifact: async () => true })).toBeNull();
  });
  it('picks the base the retired measure-base job picked', () => {
    const known = (sha) => sha !== 'gone';
    expect(baseCommit({ EVENT: 'pull_request', PR_BASE: 'pr', BEFORE: 'before' }, known)).toBe('pr');
    expect(baseCommit({ EVENT: 'push', PR_BASE: '', BEFORE: 'before' }, known)).toBe('before');
    expect(baseCommit({ EVENT: 'push', BEFORE: 'gone' }, known)).toBeNull();
    expect(baseCommit({ EVENT: 'workflow_dispatch' }, known)).toBeNull();
  });
});

describe('native credential verification stays outside the fast PR budget',()=>{
 it('runs the same focused tests on three native Node 22 platforms with scoped triggers',()=>{
  const native=workflow('credential-platform.yml'),job=native.jobs.credentials;
  expect(job.strategy.matrix.os).toEqual(['ubuntu-latest','macos-latest','windows-latest']);
  expect(job.strategy['fail-fast']).toBe(false);
  expect(native.on).not.toHaveProperty('pull_request');
  expect(native.on).toHaveProperty('workflow_dispatch');
  expect(native.permissions).toEqual({contents:'read'});
  expect(job.steps.find(step=>step.uses?.startsWith('actions/setup-node@')).with['node-version']).toBe(22);
  expect(job.steps.at(-1).run).toBe('npm test -- --files services/utils/__tests__/credential-storage.test.ts services/utils/__tests__/credential-process.test.ts');
  for(const step of job.steps.filter(step=>step.uses))expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
  expect(readFileSync(path.join(root,'.github/workflows/pr-fast.yml'),'utf8')).not.toContain('credential-platform');
  const fast=JSON.parse(readFileSync(path.join(root,'scripts/ci/fast-tests.json'),'utf8'));
  for(const file of ['credential-storage.test.ts','credential-process.test.ts'])expect(fast.some(entry=>entry.endsWith(file))).toBe(false);
  expect(native.on.push.paths).toContain('services/utils/**');
 });
});


describe('whole-install cache equivalence', () => {
  it('shares one complete fingerprint, payload and cold install policy across readers and warmers', () => {
    const jobs = ['ci.yml', 'pr-fast.yml', 'page-speed.yml'].flatMap(file => Object.values(workflow(file).jobs));
    const installs = jobs.flatMap(job => (job.steps ?? []).filter(step => step.id === 'install'));
    expect(installs.length).toBeGreaterThan(10);
    for (const job of jobs) {
      const install = job.steps?.find(step => step.id === 'install');
      if (!install) continue;
      expect(install.with).toEqual(installs[0].with);
      expect(install.with.key).toContain('${{ steps.lock.outputs.install }}');
      const index = job.steps.indexOf(install);
      expect(job.steps.slice(0, index).some(step => step.run === 'node scripts/ci/ci.mjs lock-fingerprint' && step.id === 'lock')).toBe(true);
      expect(job.steps.some(step => /^npm ci(?: |$)/.test(step.run ?? '') && step.if?.includes("steps.install.outputs.cache-hit != 'true'"))).toBe(true);
      expect(job.steps.some(step => step.with?.cache === 'npm')).toBe(false);
    }
    const base = workflow('page-speed.yml').jobs.report.steps.find(step => step.name === 'Check out base build');
    expect(base.run).toContain('cmp -s .ci-cache-key/install.json .perf-base/.ci-cache-key/install.json');
  });
});

 it('keeps every slow suite on main rather than automatic PR waits',()=>{
  for(const name of ['ci.yml','page-speed.yml','credential-platform.yml'])expect(workflow(name).on).not.toHaveProperty('pull_request');
 });
