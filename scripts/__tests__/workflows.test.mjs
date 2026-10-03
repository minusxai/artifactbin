/** CI job-ownership contracts and immutable maintenance action pins. */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'yaml';
import { describe, expect, it } from 'vitest';
import { baseCommit, chooseBaseRun, triggerPaths } from '../ci/page-speed-base.mjs';

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

describe('workflow supply-chain pins', () => {
  it('uses immutable full commit SHAs for every third-party action', () => {
    for (const file of ['ci.yml', 'cli-runtime.yml', 'release-cli.yml', 'codeql.yml', 'page-speed.yml']) {
      const text = readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      const refs = [...text.matchAll(/uses:\s+([^\s#]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
      if (file !== 'release-cli.yml') expect(refs.length, file).toBeGreaterThan(0);
      for (const ref of refs) expect(ref, `${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('dependency security', () => {
  // The source editor is CodeMirror (lib/source-editor/codemirror). Monaco
  // carried its own DOMPurify, which had to be pinned outside an advisory
  // range; it must not come back in as a second editor.
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
 * NO COMPOSE JOB HERE, AND NO IMAGE JOB EITHER. The open-source distribution is the CLI and
 * `afbin serve`; the container distribution was retired with its Dockerfile and compose file, and
 * split-deployment CI belongs to the production server repository, not this one.
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
 * NO GATE WAITS FOR THE `build` JOB. The shards used to poll it and download its artifact, which put
 * the CLI's host runtime and type declarations (no gate reads either) on every run's critical path.
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
    expect(ci.jobs.build.steps.some((step) => String(step.uses ?? '').startsWith('actions/upload-artifact'))).toBe(false);
    const start = steps.find((step) => step.name === 'Build the app, server and CLI bundle in the background');
    const wait = steps.find((step) => step.name === "Wait for this shard's build");
    // Every stream redirected and the group backgrounded, or the runner holds the step open until it ends.
    expect(start?.run).toContain('node scripts/build/build-gate-inputs.mjs');
    expect(start?.run).toMatch(/< \/dev\/null > \/dev\/null 2>&1 &\s*$/);
    expect(wait?.run).toContain('gate-build.status');
    const at = (name) => steps.findIndex((step) => step.name === name);
    // Overlapped: after the install and the island restore, before every provisioning step it overlaps.
    const restore = steps.findIndex((step) => String(step.with?.key ?? '').startsWith('test-builds-v1-'));
    expect(restore).toBeGreaterThan(-1);
    expect(steps.indexOf(start)).toBeGreaterThan(restore);
    expect(steps.indexOf(start)).toBeLessThan(at('Install selected gate browsers'));
    expect(steps.indexOf(wait)).toBeGreaterThan(at('Prepare isolated browser session workers'));
    expect(steps.indexOf(wait)).toBeLessThan(at('every gate, two servers'));
    for (const command of ['npm run build', 'npm run build -w services/cli']) {
      expect(steps.map((step) => step.run), command).not.toContain(command);
    }
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
    for (const command of ['npm run build -w services/cli', 'node scripts/build/build-server.mjs dist/server.mjs']) {
      expect(ci.jobs.build.steps.find((step) => step.run === command)?.if, command).toBe(miss);
    }
    // Every Chromium cache keys on what pins the browser, never on the whole lockfile.
    for (const [name, job] of Object.entries(ci.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.with?.path === '~/.cache/ms-playwright') expect(step.with.key, name).toContain("hashFiles('node_modules/playwright-core/browsers.json')");
      }
    }
  });
  it('builds the gate inputs with the CLI bundle options, not a second bundle definition', () => {
    const source = readFileSync(path.join(root, 'scripts/build/build-gate-inputs.mjs'), 'utf8');
    expect(source).toContain("from '../../services/cli/scripts/bundle-options.mjs'");
    expect(source).toContain("execFileSync('npm', ['run', 'build']");
  });
  it('builds the app once through the CLI host and still bundles the gate server', () => {
    const commands = ci.jobs.build.steps.map((step) => step.run);
    const cli = commands.indexOf('npm run build -w services/cli');
    const server = commands.indexOf('node scripts/build/build-server.mjs dist/server.mjs');
    expect(readFileSync(path.join(root, 'services/cli/scripts/build-host.mjs'), 'utf8'))
      .toContain("'build','-w','services/app'");
    expect(commands).not.toContain('npm run build');
    expect(cli).toBeGreaterThan(-1);
    expect(server).toBeGreaterThan(cli);
  });
});

describe('source host compatibility matrix', () => {
  it('runs source, installed package and standalone CLI against the ID-first host', () => {
    const steps = ci.jobs['reference-compatibility'].steps;
    const candidate = steps.find(step => step.name === 'ID-first conformance for bundle, installed package and executable');
    expect(candidate?.['working-directory']).toBe('candidate');
    expect(candidate?.run).toContain('afbin-consumer/node_modules/@artifactbin/cli/dist/afbin.mjs');
    expect(candidate?.run).toContain('services/cli/dist/afbin.mjs');
    expect(candidate?.run).toContain('scripts/gates.mjs --servers=1 --only=accounts-and-workspace');
    expect(readFileSync(ciPath, 'utf8')).not.toContain('build-public-packages.mjs');
  });
});

describe('Intel release acceptance consumes the tested binary',()=>{
  it('keeps packaging and browser acceptance bounded without dropping either release gate',()=>{
    const proof=ci.jobs['cli-preview'];
    expect(proof).toBeDefined();
    expect(proof.needs).toEqual(expect.arrayContaining(['plan','cli']));
    expect(proof['runs-on']).toBe('macos-15-intel');
    expect(proof.if).toContain('needs.plan.outputs.cli-preview');
    expect(proof.strategy.matrix.phase).toEqual(['preview','export-basic','export-variants']);
    expect(proof.strategy['fail-fast']).toBe(false);
    expect(proof.name).toContain('${{ matrix.phase }}');
    const download=proof.steps.find(step=>step.uses?.startsWith('actions/download-artifact'));
    expect(download?.with).toMatchObject({name:'afbin-macos-15-intel',path:'services/cli/dist'});
    expect(proof.steps.some(step=>step.run?.includes('chmod +x dist/afbin-darwin-x64'))).toBe(true);
    expect(proof.steps.some(step=>step.run?.includes('scripts/test-preview.ts dist/afbin-darwin-x64 --phase=${{ matrix.phase }}'))).toBe(true);
    expect(proof.steps.some(step=>/npm run build/.test(step.run??''))).toBe(false);
    const bundledProof=ci.jobs.cli.steps.find(step=>step.name==='File preview from the actual executable');
    expect(bundledProof.if).toContain("matrix.os != 'macos-15-intel'");
    for(const job of ['test'])expect(ci.jobs[job].needs).toContain('cli-preview');
  });
});

const workflow = (file) => yaml.parse(readFileSync(path.join(root, '.github/workflows', file), 'utf8'));

describe('code scanning runs after merge, not on every pull request', () => {
  it('analyses JavaScript/TypeScript and Actions on pushes to main and weekly, never on a pull request', () => {
    const codeql = workflow('codeql.yml');
    expect(codeql.on).not.toHaveProperty('pull_request');
    expect(codeql.on.push.branches).toEqual(['main']);
    expect(codeql.on.schedule).toHaveLength(1);
    const analyze = codeql.jobs.analyze;
    expect(analyze.strategy.matrix.language).toEqual(['actions', 'javascript-typescript']);
    expect(analyze.permissions['security-events']).toBe('write');
    const uses = analyze.steps.map((step) => step.uses ?? '');
    expect(uses.some((use) => use.startsWith('github/codeql-action/init@'))).toBe(true);
    expect(uses.some((use) => use.startsWith('github/codeql-action/analyze@'))).toBe(true);
  });
});

describe('page speed: the base is main\'s own measurement of the same bytes', () => {
  const speed = workflow('page-speed.yml');
  it('measures only the head beside the report, never a second build of main', () => {
    expect(Object.keys(speed.jobs).sort()).toEqual(['measure', 'report']);
    expect(speed.jobs.measure.strategy).toBeUndefined();
    const upload = speed.jobs.measure.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
    expect(upload.with).toMatchObject({ name: 'page-speed-head', path: 'page-speed/head.json' });
    const report = speed.jobs.report;
    expect(report.permissions.actions).toBe('read');
    const find = report.steps.find((step) => step.run === 'node scripts/ci/page-speed-base.mjs');
    expect(find.id).toBe('base');
    const fromMain = report.steps.find((step) => step.with?.['run-id'] === '${{ steps.base.outputs.run-id }}');
    expect(fromMain.if).toBe("steps.base.outputs.found == 'true'");
    expect(fromMain.with.name).toBe('page-speed-head');
    // The fallback measures the base only on a miss; the report and the size targets always run.
    const measure = report.steps.find((step) => step.name === 'Measure base');
    expect(measure.if).toBe("steps.base.outputs.found != 'true'");
    expect(measure.run).toContain('page-speed/base.json');
    for (const name of ['Report', 'Size targets']) expect(report.steps.find((step) => step.name === name).if, name).toBeUndefined();
    expect(report.steps.find((step) => step.name === 'Size targets').run).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
  it('reads the same trigger paths the workflow declares, for both events', () => {
    const paths = triggerPaths(readFileSync(path.join(root, '.github/workflows/page-speed.yml'), 'utf8'));
    expect(paths).toEqual(speed.on.push.paths);
    expect(paths).toEqual(speed.on.pull_request.paths);
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
