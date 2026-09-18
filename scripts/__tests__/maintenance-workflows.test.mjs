import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  for (const name of ['afbin-runtime-', 'afbin-chromium-', 'afbin-sql-']) expect(step.run).toContain(name);
  expect(step.run).toContain('gh run download');
});

/**
 * Runs the release workflow's "Identify the tested release" step, as written, against a stub `gh`
 * that answers from `repo`: main's head, each commit's parent and CLI version, and existing releases.
 */
function identify(repo, source) {
  const dir = mkdtempSync(join(tmpdir(), 'release-identify-'));
  try {
    const step = workflow('release-cli.yml').jobs.release.steps.find(step => step.name === 'Identify the tested release');
    const b64 = text => Buffer.from(text).toString('base64');
    const contents = {};
    for (const [sha, commit] of Object.entries(repo.commits)) {
      contents[`services/cli/package.json?ref=${sha}`] = b64(JSON.stringify({ version: commit.version }));
      contents[`services/app/public/chat/install.sh?ref=${sha}`] = b64(`#!/bin/sh\n  version=${commit.version}\n`);
      contents[`services/app/public/chat/release.json?ref=${sha}`] = b64(JSON.stringify({ version: commit.version, protocol: 2 }));
    }
    writeFileSync(join(dir, 'repo.json'), JSON.stringify({ ...repo, contents }));
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const repo = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(join(dir, 'repo.json'))}, 'utf8'));
const [command, ...args] = process.argv.slice(2);
const out = value => { process.stdout.write(String(value) + '\\n'); process.exit(0); };
if (command === 'api') {
  const path = args[0].replace(/^repos\\/[^/]+\\/[^/]+\\//, '');
  if (path === 'git/ref/heads/main') out(repo.head);
  const commit = path.match(/^commits\\/(\\w+)$/);
  if (commit) out(repo.commits[commit[1]].parent);
  const content = path.match(/^contents\\/(.+)$/);
  if (content && repo.contents[content[1]]) out(repo.contents[content[1]]);
}
if (command === 'release' && args[0] === 'view') {
  if (args[0] === 'view' && args[1] in (repo.releases ?? {})) out(repo.releases[args[1]].draft);
  process.stderr.write('release not found\\n'); process.exit(1);
}
process.stderr.write('unexpected gh ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(2);
`);
    chmodSync(join(dir, 'gh'), 0o755);
    const output = join(dir, 'output');
    writeFileSync(output, '');
    execFileSync('bash', ['-c', step.run], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'minusxai/artifactbin', GITHUB_OUTPUT: output, SOURCE_SHA: source, SOURCE_RUN: '42' },
    });
    return Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean).map(line => line.split('=')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const sha = letter => letter.repeat(40);

it('publishes a version bump even after unrelated merges landed on main while its CI ran', () => {
  // a: 0.1.48 released; b: the 0.1.49 bump; c, d: other work merged on top before b's CI finished.
  const repo = { head: sha('d'), commits: { [sha('a')]: { version: '0.1.48', parent: sha('0') }, [sha('b')]: { version: '0.1.49', parent: sha('a') }, [sha('c')]: { version: '0.1.49', parent: sha('b') }, [sha('d')]: { version: '0.1.49', parent: sha('c') } }, releases: { 'afbin-v0.1.48': { draft: false } } };
  expect(identify(repo, sha('b'))).toEqual({ tag: 'afbin-v0.1.49', sha: sha('b') });
});

it('leaves a later merge that did not bump the version to the bump commit, which built the binaries', () => {
  const repo = { head: sha('c'), commits: { [sha('a')]: { version: '0.1.48', parent: sha('0') }, [sha('b')]: { version: '0.1.49', parent: sha('a') }, [sha('c')]: { version: '0.1.49', parent: sha('b') } } };
  expect(identify(repo, sha('c'))).toEqual({});
});

it('never publishes a version that a newer bump on main has superseded', () => {
  const repo = { head: sha('c'), commits: { [sha('a')]: { version: '0.1.48', parent: sha('0') }, [sha('b')]: { version: '0.1.49', parent: sha('a') }, [sha('c')]: { version: '0.1.50', parent: sha('b') } } };
  expect(identify(repo, sha('b'))).toEqual({});
});

it('leaves a published version alone and recovers a draft', () => {
  const repo = { head: sha('b'), commits: { [sha('a')]: { version: '0.1.48', parent: sha('0') }, [sha('b')]: { version: '0.1.49', parent: sha('a') } } };
  expect(identify({ ...repo, releases: { 'afbin-v0.1.49': { draft: false } } }, sha('b'))).toEqual({});
  expect(identify({ ...repo, releases: { 'afbin-v0.1.49': { draft: true } } }, sha('b'))).toEqual({ tag: 'afbin-v0.1.49', sha: sha('b') });
});
