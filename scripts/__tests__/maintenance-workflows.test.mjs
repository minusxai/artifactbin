import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
const root = resolve(import.meta.dirname, '../..');
const workflow = name => parse(readFileSync(resolve(root, '.github/workflows', name), 'utf8'));
it('keeps cloud deployment and paid smoke out of OSS', () => {
  for (const name of ['publish.yml', 'performance.yml', 'agent-smoke-nightly.yml', 'update-cli-version.yml']) {
    expect(existsSync(resolve(root, '.github/workflows', name)), name).toBe(false);
  }
});
it('exposes usable manual-only runtime maintenance', () => {
  const definition = workflow('cli-runtime.yml');
  expect(Object.keys(definition.on)).toEqual(['workflow_dispatch']);
  for (const job of Object.values(definition.jobs)) expect(job.if).toBeUndefined();
});
it('does not schedule copied paid agent jobs in OSS CI', () => {
  const definition = workflow('ci.yml');
  expect(definition.jobs).not.toHaveProperty('agent-smoke');
  expect(definition.jobs).not.toHaveProperty('mx-agent-trials');
  expect(definition.jobs.plan.outputs).not.toHaveProperty('agent-smoke');
  for (const job of Object.values(definition.jobs)) {
    expect(job.needs ?? []).not.toContain('agent-smoke');
    expect(job.needs ?? []).not.toContain('mx-agent-trials');
  }
});

it('publishes only successful main CI artifacts, including all lazy runtime assets', () => {
  const definition = workflow('release-cli.yml');
  expect(definition.on.workflow_run.workflows).toEqual(['ci']);
  expect(definition.jobs.release.if).toContain("github.event.workflow_run.conclusion == 'success'");
  const step = definition.jobs.release.steps.find(step => step.name === 'Download the binaries tested by this CI run');
  for (const name of ['afbin-runtime-', 'afbin-chromium-']) expect(step.run).toContain(name);
  // The SQL engine is inside the executable: there is no separate package to publish.
  expect(step.run).not.toContain('afbin-sql-');
  expect(step.run).toContain('gh run download');
});


/** Every platform a release carries: the CI runner that builds it and the asset suffix it ships as. */
const PLATFORMS = { 'macos-14': 'darwin-arm64', 'macos-15-intel': 'darwin-x64', 'ubuntu-24.04': 'linux-x64', 'ubuntu-24.04-arm': 'linux-arm64', 'windows-2022': 'win32-x64' };

/** A CI run's `afbin-<runner>` artifacts as the `cli` job uploads them, each file naming the run that built it. */
function binaries(version, run, runners = Object.keys(PLATFORMS)) {
  return Object.fromEntries(runners.map(runner => {
    const platform = PLATFORMS[runner];
    const binary = `afbin-${platform}${runner.startsWith('windows') ? '.exe' : ''}`;
    const built = name => `${name} ${version} built by run ${run}`;
    return [`afbin-${runner}`, {
      [binary]: built(binary),
      [`${binary}.manifest.json`]: JSON.stringify({ version, platform }),
      [`${binary}.gz`]: built(`${binary}.gz`),
      [`${binary}.sizes.json`]: '{}',
      [`afbin-runtime-${platform}.gz`]: built(`afbin-runtime-${platform}.gz`),
      [`afbin-chromium-${platform}.gz`]: built(`afbin-chromium-${platform}.gz`),
      'afbin-skills.json': JSON.stringify({ version }),
      'afbin.1': `afbin ${version}`,
    }];
  }));
}

/** Main CI's `tested-run` artifact: the run whose bytes the merged tree was tested with. */
const testedRun = id => ({ 'tested-run': { 'tested-run.json': JSON.stringify({ run_id: id }) } });

/**
 * A `gh` that answers from a JSON state file shaped like the GitHub API, applies `--jq` with the real
 * `jq`, and logs every tag, release and upload it is asked to make.
 */
const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const state = process.env.GH_STUB_STATE;
const repo = JSON.parse(fs.readFileSync(state, 'utf8'));
const argv = process.argv.slice(2);
const flag = name => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
const fail = message => { process.stderr.write(message + '\\n'); process.exit(1); };
const record = call => { repo.calls.push(call); fs.writeFileSync(state, JSON.stringify(repo)); };
const answer = value => {
  const jq = flag('--jq');
  if (jq === undefined) { process.stdout.write(JSON.stringify(value) + '\\n'); process.exit(0); }
  const result = spawnSync('jq', ['-r', jq], { input: JSON.stringify(value), encoding: 'utf8' });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status);
};
const [command, action, target] = argv;
if (command === 'api') {
  const route = argv.find(arg => arg.startsWith('repos/')).replace(/^repos\\/[^/]+\\/[^/]+\\//, '');
  const [route_path] = route.split('?');
  const fields = Object.fromEntries(argv.flatMap((arg, at) => arg === '-f' ? [argv[at + 1].split(/=(.*)/s).slice(0, 2)] : []));
  let match;
  if (route_path === 'git/ref/heads/main') answer({ object: { sha: repo.head } });
  if (route_path.startsWith('contents/')) { if (route in repo.contents) answer({ content: repo.contents[route] }); fail('gh: Not Found (HTTP 404)'); }
  if ((match = route_path.match(/^git\\/ref\\/tags\\/(.+)$/))) { if (repo.tags[match[1]]) answer({ object: { type: 'commit', sha: repo.tags[match[1]] } }); fail('gh: Not Found (HTTP 404)'); }
  if (route_path === 'git/refs' && flag('--method') === 'POST') { const tag = fields.ref.replace('refs/tags/', ''); repo.tags[tag] = fields.sha; record('tag ' + tag + ' ' + fields.sha); answer({ ref: fields.ref }); }
  if ((match = route_path.match(/^actions\\/runs\\/(\\d+)\\/artifacts$/))) answer({ artifacts: Object.keys(repo.runs[match[1]] ?? {}).map(name => ({ name, expired: false })) });
}
if (command === 'run' && action === 'download') {
  const files = repo.runs[target]?.[flag('--name')];
  if (!files) fail('no valid artifacts found to download');
  fs.mkdirSync(flag('--dir'), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(flag('--dir'), name), text);
  process.exit(0);
}
if (command === 'release' && action === 'view') { if (target in repo.releases) answer({ isDraft: repo.releases[target].draft }); fail('release not found'); }
if (command === 'release' && action === 'create') { repo.releases[target] = { draft: true }; record('create ' + target); process.exit(0); }
if (command === 'release' && action === 'upload') { const file = argv.at(-1); record('upload ' + path.basename(file) + ': ' + fs.readFileSync(file, 'utf8').split('\\n')[0]); process.exit(0); }
if (command === 'release' && action === 'edit' && argv.includes('--draft=false')) { repo.releases[target].draft = false; record('publish ' + target); process.exit(0); }
process.stderr.write('unexpected gh ' + argv.join(' ') + '\\n'); process.exit(2);
`;

/**
 * Runs the release job, every step as written and in order, for main CI run 42 of `source` against
 * a stub `gh` answering from `repo`: main's head, each commit's CLI version (and the installer and
 * pointer that ship with it, which match unless a commit says otherwise), existing tags and releases,
 * and each CI run's artifacts. Step `if:`s, step outputs and `$GITHUB_ENV` behave as on Actions.
 */
function release(repo, source) {
  const dir = mkdtempSync(join(tmpdir(), 'release-cli-'));
  try {
    const job = workflow('release-cli.yml').jobs.release;
    const b64 = text => Buffer.from(text).toString('base64');
    const contents = {};
    for (const [sha, commit] of Object.entries(repo.commits)) {
      contents[`contents/services/cli/package.json?ref=${sha}`] = b64(JSON.stringify({ version: commit.version }));
      contents[`contents/services/app/public/chat/install.sh?ref=${sha}`] = b64(`#!/bin/sh\n  version=${commit.installer ?? commit.version}\n`);
      contents[`contents/services/app/public/chat/release.json?ref=${sha}`] = b64(JSON.stringify({ version: commit.pointer ?? commit.version, protocol: 2 }));
    }
    const state = join(dir, 'state.json');
    writeFileSync(state, JSON.stringify({ releases: {}, tags: {}, runs: {}, ...repo, contents, calls: [] }));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'gh'), GH_STUB);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    const workspace = join(dir, 'workspace');
    mkdirSync(workspace);

    const context = { 'github.token': 'test-token', 'github.event.workflow_run.head_sha': source, 'github.event.workflow_run.id': '42' };
    const outputs = {};
    const expand = text => String(text).replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, expression) => {
      const step = expression.match(/^steps\.([\w-]+)\.outputs\.([\w-]+)$/);
      if (step) return outputs[step[1]]?.[step[2]] ?? '';
      if (expression in context) return context[expression];
      throw new Error(`The harness does not model \${{ ${expression} }}`);
    });
    const expandAll = values => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, expand(value)]));
    const readPairs = file => Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
    let env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GH_STUB_STATE: state, GITHUB_REPOSITORY: 'minusxai/artifactbin', ...expandAll(job.env) };
    let failure = null;
    for (const step of job.steps) {
      if (step.if !== undefined) {
        const condition = step.if.match(/^steps\.([\w-]+)\.outputs\.([\w-]+) != ''$/);
        if (!condition) throw new Error(`The harness does not model if: ${step.if}`);
        if (!outputs[condition[1]]?.[condition[2]]) continue;
      }
      const output = join(dir, 'output'), carried = join(dir, 'env');
      writeFileSync(output, '');
      writeFileSync(carried, '');
      const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
        cwd: workspace, encoding: 'utf8', env: { ...env, ...expandAll(step.env), GITHUB_OUTPUT: output, GITHUB_ENV: carried },
      });
      if (run.status !== 0) { failure = `${step.name}: ${run.stdout}${run.stderr}`; break; }
      if (step.id) outputs[step.id] = readPairs(output);
      env = { ...env, ...readPairs(carried) };
    }
    const published = Object.fromEntries(Object.entries(expandAll(job.outputs)).filter(([, value]) => value));
    const { calls, releases } = JSON.parse(readFileSync(state, 'utf8'));
    return { failure, outputs: published, calls, releases };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const sha = letter => letter.repeat(40);
const uploaded = calls => calls.filter(call => call.startsWith('upload ')).map(call => call.slice('upload '.length));

it('publishes a rebase-merged bump that landed below main\'s head, from the run that tested the head', () => {
  // PR #124 rebase-merged as b (the 0.3.3 bump) and c on top, pushed together: main CI ran for c alone,
  // and the tree it carried was the one the PR's run 7 tested and built 0.3.3's binaries from.
  const repo = {
    head: sha('c'),
    commits: { [sha('a')]: { version: '0.3.2' }, [sha('b')]: { version: '0.3.3' }, [sha('c')]: { version: '0.3.3' } },
    releases: { 'afbin-v0.3.2': { draft: false } },
    runs: { 42: testedRun(7), 7: binaries('0.3.3', 7) },
  };
  const result = release(repo, sha('c'));
  expect(result.failure).toBeNull();
  expect(result.outputs).toEqual({ tag: 'afbin-v0.3.3', sha: sha('c') });
  expect(result.calls.slice(0, 2)).toEqual([`tag afbin-v0.3.3 ${sha('c')}`, 'create afbin-v0.3.3']);
  expect(result.calls.at(-1)).toBe('publish afbin-v0.3.3');
  expect(result.releases['afbin-v0.3.3']).toEqual({ draft: false });
  for (const platform of Object.values(PLATFORMS)) {
    const binary = `afbin-${platform}${platform.startsWith('win32') ? '.exe' : ''}`;
    expect(uploaded(result.calls)).toEqual(expect.arrayContaining([
      `${binary}: ${binary} 0.3.3 built by run 7`,
      `afbin-runtime-${platform}.gz: afbin-runtime-${platform}.gz 0.3.3 built by run 7`,
      `afbin-chromium-${platform}.gz: afbin-chromium-${platform}.gz 0.3.3 built by run 7`,
    ]));
  }
  expect(uploaded(result.calls).map(call => call.split(':')[0])).toEqual(expect.arrayContaining(['SHA256SUMS', 'afbin-skills.json', 'afbin.1']));
});

it('publishes nothing for a merge whose tested run built no binaries', () => {
  // c merged on top of the 0.1.49 bump b without changing the version, so its run built no binaries;
  // b's own run holds them and publishes whenever it finishes.
  const repo = {
    head: sha('c'),
    commits: { [sha('a')]: { version: '0.1.48' }, [sha('b')]: { version: '0.1.49' }, [sha('c')]: { version: '0.1.49' } },
    releases: { 'afbin-v0.1.48': { draft: false } },
    runs: { 42: { ...testedRun(9) }, 9: { 'app-build': { 'server.mjs': '' } } },
  };
  expect(release(repo, sha('c'))).toEqual({ failure: null, outputs: {}, calls: [], releases: repo.releases });
  // Main's own run, no tested-run artifact and no binaries: the same no-op.
  expect(release({ ...repo, runs: {} }, sha('c'))).toEqual({ failure: null, outputs: {}, calls: [], releases: repo.releases });
});

it('publishes a version bump even after unrelated merges landed on main while its CI ran', () => {
  // a: 0.1.48 released; b: the 0.1.49 bump; c, d: other work merged on top before b's CI finished.
  const repo = {
    head: sha('d'),
    commits: { [sha('a')]: { version: '0.1.48' }, [sha('b')]: { version: '0.1.49' }, [sha('c')]: { version: '0.1.49' }, [sha('d')]: { version: '0.1.49' } },
    releases: { 'afbin-v0.1.48': { draft: false } },
    runs: { 42: binaries('0.1.49', 42) },
  };
  const result = release(repo, sha('b'));
  expect(result.failure).toBeNull();
  expect(result.outputs).toEqual({ tag: 'afbin-v0.1.49', sha: sha('b') });
  expect(result.calls.at(-1)).toBe('publish afbin-v0.1.49');
});

it('never publishes a version that a newer bump on main has superseded', () => {
  const repo = {
    head: sha('c'),
    commits: { [sha('a')]: { version: '0.1.48' }, [sha('b')]: { version: '0.1.49' }, [sha('c')]: { version: '0.1.50' } },
    runs: { 42: binaries('0.1.49', 42) },
  };
  expect(release(repo, sha('b'))).toMatchObject({ failure: null, outputs: {}, calls: [] });
});

it('leaves a published version alone and recovers a draft', () => {
  const repo = {
    head: sha('b'),
    commits: { [sha('a')]: { version: '0.1.48' }, [sha('b')]: { version: '0.1.49' } },
    runs: { 42: binaries('0.1.49', 42) },
  };
  expect(release({ ...repo, releases: { 'afbin-v0.1.49': { draft: false } } }, sha('b'))).toMatchObject({ failure: null, outputs: {}, calls: [] });
  // An earlier attempt tagged the commit and left a partial draft: re-upload everything, then publish.
  const recovered = release({ ...repo, tags: { 'afbin-v0.1.49': sha('b') }, releases: { 'afbin-v0.1.49': { draft: true } } }, sha('b'));
  expect(recovered.failure).toBeNull();
  expect(recovered.outputs).toEqual({ tag: 'afbin-v0.1.49', sha: sha('b') });
  expect(recovered.calls.filter(call => !call.startsWith('upload '))).toEqual(['publish afbin-v0.1.49']);
});

it('refuses, before tagging anything, a tested run holding only some of the binaries', () => {
  const repo = {
    head: sha('b'),
    commits: { [sha('a')]: { version: '0.1.48' }, [sha('b')]: { version: '0.1.49' } },
    runs: { 42: binaries('0.1.49', 42, ['macos-14', 'ubuntu-24.04']) },
  };
  const result = release(repo, sha('b'));
  expect(result.failure).toMatch(/afbin-windows-2022/);
  expect(result.calls).toEqual([]);
});

it('refuses, before tagging anything, binaries whose manifest names another version', () => {
  const repo = {
    head: sha('b'),
    commits: { [sha('a')]: { version: '0.1.48' }, [sha('b')]: { version: '0.1.49' } },
    runs: { 42: binaries('0.1.48', 42) },
  };
  const result = release(repo, sha('b'));
  expect(result.failure).toMatch(/0\.1\.48/);
  expect(result.calls).toEqual([]);
});

it('refuses a commit whose installer or release pointer names another version', () => {
  const commits = { [sha('a')]: { version: '0.1.48' } };
  const runs = { 42: binaries('0.1.49', 42) };
  for (const drift of [{ installer: '0.1.48' }, { pointer: '0.1.48' }]) {
    const result = release({ head: sha('b'), commits: { ...commits, [sha('b')]: { version: '0.1.49', ...drift } }, runs }, sha('b'));
    expect(result.failure, JSON.stringify(drift)).toMatch(/Identify the tested release/);
    expect(result.calls).toEqual([]);
  }
});
