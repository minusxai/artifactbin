import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const SKILL_URL = 'https://app.artefactbin.dev/skills/artifactbin.zip';
const cli = JSON.parse(read('services/cli/package.json'));
const afbin = (args) => spawnSync(process.execPath, [path.join(root, 'services/cli', cli.bin.afbin), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });

describe('the CLI retirement build', () => {
  it('is @afbin/cli 0.6.0, one file with no dependencies, the version the pointer and the server switch name', () => {
    expect(cli).toMatchObject({ name: '@afbin/cli', version: '0.6.0', bin: { afbin: 'bin/afbin.mjs' }, files: ['bin/afbin.mjs'] });
    expect(cli).not.toHaveProperty('dependencies');
    expect(cli).not.toHaveProperty('scripts');
    expect(JSON.parse(read('services/app/public/chat/release.json')).version).toBe(cli.version);
    expect(read('services/app/lib/platform/config.ts')).toContain(`export const CLI_RETIREMENT_VERSION = '${cli.version}';`);
    // Not a workspace: the root install and lockfile stay exactly v3's.
    expect(JSON.parse(read('package.json')).workspaces).not.toContain('services/cli');
    expect(read('package-lock.json')).not.toContain('"services/cli"');
  });

  it('answers every command, --version and setup included, with the retirement notice and exit 0', () => {
    for (const args of [[], ['--version'], ['setup'], ['update'], ['serve'], ['publish', 'page.html'], ['--help']]) {
      const run = afbin(args);
      expect(run.status, args.join(' ')).toBe(0);
      expect(run.stdout, args.join(' ')).toContain(`The artifactbin CLI (afbin) is retired. Agents now use the Artifactbin author skill: ${SKILL_URL}`);
      expect(run.stdout).toContain('npm uninstall -g @afbin/cli');
      expect(run.stderr).toBe('');
    }
    const json = afbin(['--version', '--json']);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ retired: true, skill_url: SKILL_URL, npm: { status: 'manual', command: 'npm uninstall -g @afbin/cli' } });
  });

  it('packs to the three files release-cli.yml accepts', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'afbin-pack-'));
    try {
      const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts', '--pack-destination', out], { cwd: path.join(root, 'services/cli'), encoding: 'utf8' }));
      expect(packed.filename).toBe(`afbin-cli-${cli.version}.tgz`);
      expect(packed.files.map((file) => file.path).sort()).toEqual(['README.md', 'bin/afbin.mjs', 'package.json']);
      expect(packed.files.find((file) => file.path === 'bin/afbin.mjs').mode & 0o111).not.toBe(0);
      expect(read('.github/workflows/release-cli.yml')).toContain("printf '%s\\n' package/README.md package/bin/afbin.mjs package/package.json > expected-files.txt");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('the CLI retirement release path', () => {
  const ci = yaml.parse(read('.github/workflows/ci.yml'));
  const release = yaml.parse(read('.github/workflows/release-cli.yml'));

  it('packs and signs in every ci run, independent of the plan, and the roll-up requires it', () => {
    const job = ci.jobs['cli-pack'];
    expect(job.needs).toBeUndefined();
    expect(job.if).toBe("(github.event_name != 'pull_request' || github.base_ref != 'artifactbinv3')");
    expect(job.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(job.steps.find((step) => step.uses?.startsWith('actions/setup-node@')).with['node-version']).toBe('22.23.4');
    const run = job.steps.map((step) => step.run ?? '').join('\n');
    expect(run).toContain('npm pack --ignore-scripts --pack-destination ../../dist/npm');
    expect(run).toContain('node scripts/ci/npm-provenance.mjs sign "$PACKAGE_FILE" "$PACKAGE_VERSION"');
    expect(run).toContain('npm view "@afbin/cli@$version" version');
    expect(run).not.toContain('npm publish');
    const upload = job.steps.find((step) => step.with?.name === 'afbin-npm-release');
    expect(upload.if).toContain("steps.pack.outputs.release == 'true'");
    expect(ci.jobs.test.needs).toContain('cli-pack');
    for (const [name, other] of Object.entries(ci.jobs)) if (name !== 'cli-pack') expect(JSON.stringify(other.steps ?? []), name).not.toContain('npm publish');
  });

  it('fails the roll-up when cli-pack fails', () => {
    const plan = { jobs: { checks: true, node: false, integration: false, ui: false, build: false, api: false, gates: false } };
    const needs = (result) => ({ plan: { result: 'success', outputs: { plan: JSON.stringify(plan) } }, checks: { result: 'success' }, ...Object.fromEntries(['node', 'integration', 'ui', 'build', 'api', 'gates'].map((job) => [job, { result: 'skipped' }])), 'cli-pack': { result } });
    const check = (result) => spawnSync(process.execPath, [path.join(root, 'scripts/ci/ci.mjs'), 'check'], { encoding: 'utf8', env: { PATH: process.env.PATH, CI__NEEDS: JSON.stringify(needs(result)) } });
    expect(check('success').status).toBe(0);
    expect(check('skipped').status).toBe(0);
    const failed = check('failure');
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('cli-pack');
  });

  it('publishes only after a green push to main whose head still names the version, through trusted publishing', () => {
    expect(release.on.workflow_run).toEqual({ workflows: ['ci'], types: ['completed'], branches: ['main'] });
    const job = release.jobs.release;
    expect(job.if).toContain("github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'");
    expect(release.permissions['id-token']).toBe('write');
    const run = job.steps.map((step) => step.run ?? '').join('\n');
    expect(run).toContain('contents/services/cli/package.json?ref=$1');
    expect(run).toContain('contents/services/app/public/chat/release.json?ref=$SOURCE_SHA');
    expect(run).toContain('test "$(jq -r .head_branch <<< "$admission")" = main');
    expect(run).toContain('--name afbin-npm-release');
    expect(run).toContain('node scripts/ci/npm-provenance.mjs verify "$file" "$version" "$build_sha" "$SOURCE_RUN"');
    expect(run).toContain('npm publish "$PACKAGE_FILE" --access public --provenance-file "$PACKAGE_FILE.sigstore" --ignore-scripts');
    // Nothing of the old CLI's release plumbing is left to find.
    expect(run).not.toMatch(/transition|shrinkwrap|tested-run/);
  });
});
