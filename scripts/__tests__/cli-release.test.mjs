import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../..');
const workflow = parse(readFileSync(join(root, '.github/workflows/release-cli.yml'), 'utf8'));
const sha = 'a'.repeat(40);

it('patch bump keeps package, lockfile, installer and release pointer synchronized', () => {
  const dir = mkdtempSync(join(tmpdir(), 'afbin-bump-'));
  try {
    mkdirSync(join(dir, 'services/cli'), { recursive: true });
    mkdirSync(join(dir, 'services/app/public/chat'), { recursive: true });
    writeFileSync(join(dir, 'services/cli/package.json'), '{"version": "0.1.9"}\n');
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'services/cli': { version: '0.1.9' } } }));
    writeFileSync(join(dir, 'services/app/public/chat/install.sh'), '  version=0.1.9\n--version 0.1.9\n');
    writeFileSync(join(dir, 'services/app/public/chat/release.json'), '{\n  "version": "0.1.9",\n  "protocol": 1\n}\n');
    const run = spawnSync(process.execPath, [join(root, 'scripts/bump-cli-version.mjs')], { cwd: dir });
    expect(run.status, run.stderr.toString()).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'services/cli/package.json'))).version).toBe('0.1.10');
    expect(JSON.parse(readFileSync(join(dir, 'package-lock.json'))).packages['services/cli'].version).toBe('0.1.10');
    expect(readFileSync(join(dir, 'services/app/public/chat/install.sh'), 'utf8')).toContain('version=0.1.10');
    expect(JSON.parse(readFileSync(join(dir, 'services/app/public/chat/release.json'))).version).toBe('0.1.10');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('a drifted release pointer stops the bump instead of publishing a mismatched release', () => {
  const dir = mkdtempSync(join(tmpdir(), 'afbin-bump-drift-'));
  try {
    mkdirSync(join(dir, 'services/cli'), { recursive: true });
    mkdirSync(join(dir, 'services/app/public/chat'), { recursive: true });
    writeFileSync(join(dir, 'services/cli/package.json'), '{"version": "0.1.9"}\n');
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'services/cli': { version: '0.1.9' } } }));
    writeFileSync(join(dir, 'services/app/public/chat/install.sh'), '  version=0.1.9\n');
    writeFileSync(join(dir, 'services/app/public/chat/release.json'), '{"version": "0.1.8", "protocol": 1}\n');
    const run = spawnSync(process.execPath, [join(root, 'scripts/bump-cli-version.mjs')], { cwd: dir });
    expect(run.status).not.toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'services/cli/package.json'))).version).toBe('0.1.9');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('the checked-in pointer, installer and CLI package name one release, at this protocol', () => {
  const version = JSON.parse(readFileSync(join(root, 'services/cli/package.json'), 'utf8')).version;
  const pointer = JSON.parse(readFileSync(join(root, 'services/app/public/chat/release.json'), 'utf8'));
  const protocol = /CLI_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(readFileSync(join(root, 'services/contracts/src/cli-auth.ts'), 'utf8'));
  expect(pointer.version).toBe(version);
  expect(String(pointer.protocol)).toBe(protocol[1]);
  expect(readFileSync(join(root, 'services/app/public/chat/install.sh'), 'utf8')).toContain(`  version=${version}\n`);
});

it('every CLI release path publishes the canary plugin channel from the same commit', () => {
  const pluginWorkflow = parse(readFileSync(join(root, '.github/workflows/publish-plugin.yml'), 'utf8'));
  const triggers = pluginWorkflow.on ?? pluginWorkflow[true];
  expect(Object.keys(triggers)).toEqual(expect.arrayContaining(['workflow_dispatch', 'workflow_call']));
  const guard = pluginWorkflow.jobs.publish.steps.find((step) => step.name?.startsWith('Verify and check out'));
  expect(guard.run).toContain('production publication must be dispatched explicitly');
  for (const [file, source] of [['release-cli.yml', 'release'], ['publish-cli.yml', 'verify']]) {
    const caller = file === 'release-cli.yml' ? workflow : parse(readFileSync(join(root, '.github/workflows', file), 'utf8'));
    expect(caller.jobs.plugin.uses, file).toBe('./.github/workflows/publish-plugin.yml');
    expect(caller.jobs.plugin.with.channel, file).toBe('staging');
    expect(caller.jobs.plugin.with.source_sha, file).toBe(`\${{ needs.${source}.outputs.sha }}`);
    expect(caller.jobs[source].outputs.sha, file).toBeTruthy();
  }
});

it('a published plugin version never moves backwards, and a republish of the same version is allowed', async () => {
  const { assertMonotonicVersion, PLUGIN_VERSION } = await import('../../services/app/lib/plugin-package.ts');
  expect(PLUGIN_VERSION).toBe(JSON.parse(readFileSync(join(root, 'services/cli/package.json'), 'utf8')).version);
  expect(assertMonotonicVersion(undefined, '0.2.0')).toBe('0.2.0');
  expect(assertMonotonicVersion('0.1.9', '0.1.9')).toBe('0.1.9');
  expect(assertMonotonicVersion('0.1.9', '0.1.10')).toBe('0.1.10');
  expect(() => assertMonotonicVersion('0.2.0', '0.1.10')).toThrow(/older than the published/);
  expect(() => assertMonotonicVersion('0.2.0', 'latest')).toThrow(/MAJOR\.MINOR\.PATCH/);
});

it('both plugin channels build from the same bundled teaching and keep distinct identities', async () => {
  const { buildPluginFiles, PLUGIN_VERSION } = await import('../../services/app/lib/plugin-package.ts');
  const { default: teaching } = await import('../../services/cli/src/generated/teaching.json', { with: { type: 'json' } });
  const production = buildPluginFiles(undefined, 'production');
  const staging = buildPluginFiles('https://afx-oss.artifactbin.dev', 'staging');
  expect(JSON.parse(production['.claude-plugin/plugin.json']).name).toBe('artifactbin');
  expect(JSON.parse(staging['.claude-plugin/plugin.json']).name).toBe('artifactbin-oss');
  for (const files of [production, staging]) {
    expect(JSON.parse(files['.claude-plugin/plugin.json']).version).toBe(PLUGIN_VERSION);
    expect(files['README.md']).toContain('/chat/install.sh');
    expect(files['README.md']).not.toMatch(/npm install -g|npx afbin/);
  }
  for (const [file, text] of Object.entries(teaching.files)) {
    expect(production[`skills/artifactbin/${file}`], file).toBe(text);
    expect(staging[`skills/artifactbin-oss/${file}`].replace(/^name: artifactbin-oss$/m, 'name: artifactbin'), file).toBe(text);
  }
});

for (const scenario of ['new', 'published', 'stale', 'draft']) {
  it(`release workflow handles ${scenario} builds without running binaries`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'afbin-release-'));
    try {
      const gh = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), all = args.join(' ');
fs.appendFileSync('calls', all + '\\n');
const scenario = process.env.SCENARIO;
if (all.includes('git/ref/heads/main')) console.log(scenario === 'stale' ? 'b'.repeat(40) : process.env.SOURCE_SHA);
else if(all.includes('contents/services/cli/package.json')) console.log(Buffer.from('{"version":"0.1.1"}').toString('base64'));
else if(all.includes('contents/services/app/public/chat/install.sh')) console.log(Buffer.from('  version=0.1.1\\n').toString('base64'));
else if(all.includes('contents/services/app/public/chat/release.json')) console.log(Buffer.from('{"version":"0.1.1","protocol":1}').toString('base64'));
else if(all.startsWith('release view')) {
  if (scenario === 'published') console.log('false');
  else if (scenario === 'draft') console.log('true');
  else { console.error('release not found'); process.exit(1); }
} else if (all.includes('git/ref/tags/')) {
  if(scenario === 'draft') console.log(JSON.stringify({object:{type:'commit',sha:process.env.SOURCE_SHA}}));
  else { console.error('HTTP 404'); process.exit(1); }
} else if (all.startsWith('run download')) {
  const dir=args[args.indexOf('--dir')+1], name=args[args.indexOf('--name')+1];
  const mapping={'afbin-macos-14':'darwin-arm64','afbin-macos-15-intel':'darwin-x64','afbin-ubuntu-24.04':'linux-x64','afbin-ubuntu-24.04-arm':'linux-arm64'};
  fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(dir+'/afbin-'+mapping[name], 'test binary');
  fs.writeFileSync(dir+'/afbin-'+mapping[name]+'.manifest.json', '{}');
  fs.writeFileSync(dir+'/afbin-skills.json', '{"version":"0.1.1","protocol":1,"files":{}}');
  fs.writeFileSync(dir+'/afbin.1', 'manual');
} else if (!(all.startsWith('api --method POST') || all.startsWith('release create') || all.startsWith('release upload') || all.startsWith('release edit'))) process.exit(2);
`;
      writeFileSync(join(dir, 'gh'), gh, { mode: 0o755 });
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, SCENARIO: scenario, SOURCE_SHA: sha, SOURCE_RUN: '123', GITHUB_REPOSITORY: 'test/repo', GITHUB_OUTPUT: join(dir, 'output'), RELEASE_TAG: 'afbin-v0.1.1' };
      const steps = workflow.jobs.release.steps;
      const run = (script) => {
        const result = spawnSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      };
      run(steps[0].run);
      if (['published', 'stale'].includes(scenario)) {
        expect(existsSync(join(dir, 'output'))).toBe(false);
      } else {
        run(steps[1].run); run(steps[2].run);
        expect(readFileSync(join(dir, 'bundle/SHA256SUMS'), 'utf8').trim().split('\n')).toHaveLength(10);
        const calls = readFileSync(join(dir, 'calls'), 'utf8');
        expect(calls).toContain('release edit afbin-v0.1.1');
        expect(calls).toContain(scenario === 'draft' ? 'release upload' : 'release create');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
