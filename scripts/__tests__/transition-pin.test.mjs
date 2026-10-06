import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** `npm run release:cli` moves the transition asset's pin with the other lockstep files. */
const root = resolve(import.meta.dirname, '../..');
const transition = 'services/cli/transition/afbin';
const script = (version) => `#!/bin/sh\n# bootstrap\nAFBIN_VERSION=${version}\nAFBIN_PROTOCOL=3\nset -u\n`;

function fixture(transitionVersion) {
  const dir = mkdtempSync(join(tmpdir(), 'afbin-bump-transition-'));
  mkdirSync(join(dir, 'services/cli/transition'), { recursive: true });
  mkdirSync(join(dir, 'services/app/public/chat'), { recursive: true });
  writeFileSync(join(dir, 'services/cli/package.json'), '{"version": "0.1.9"}\n');
  writeFileSync(join(dir, 'services/cli/npm-shrinkwrap.json'), JSON.stringify({ version: '0.1.9', packages: { '': { version: '0.1.9' } } }));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'services/cli': { version: '0.1.9' } } }));
  writeFileSync(join(dir, 'services/app/public/chat/install.sh'), 'npx --yes @afbin/cli@latest setup\n');
  writeFileSync(join(dir, 'services/app/public/chat/install.ps1'), 'npx.cmd --yes @afbin/cli@latest setup\n');
  writeFileSync(join(dir, 'services/app/public/chat/release.json'), '{\n  "version": "0.1.9",\n  "protocol": 1\n}\n');
  if (transitionVersion) writeFileSync(join(dir, transition), script(transitionVersion), { mode: 0o755 });
  return dir;
}
const bump = (dir) => spawnSync(process.execPath, [join(root, 'scripts/bump-cli-version.mjs')], { cwd: dir, encoding: 'utf8' });

it('a bump rewrites the transition pin and nothing else in the script, keeping it executable', () => {
  const dir = fixture('0.1.9');
  try {
    const run = bump(dir);
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(dir, transition), 'utf8')).toBe(script('0.1.10'));
    expect(statSync(join(dir, transition)).mode & 0o777).toBe(0o755);
    expect(JSON.parse(readFileSync(join(dir, 'services/cli/package.json'))).version).toBe('0.1.10');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [label, version] of [['a drifted', '0.1.8'], ['an absent', undefined]]) {
  it(`${label} transition pin stops the bump before any file changes`, () => {
    const dir = fixture(version);
    try {
      const run = bump(dir);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(transition);
      expect(JSON.parse(readFileSync(join(dir, 'services/cli/package.json'))).version).toBe('0.1.9');
      expect(readFileSync(join(dir, 'services/app/public/chat/install.sh'), 'utf8')).toBe('npx --yes @afbin/cli@latest setup\n');
      if (version) expect(readFileSync(join(dir, transition), 'utf8')).toBe(script(version));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

it('the checked-in transition script is pinned to the CLI package version and protocol', () => {
  const version = JSON.parse(readFileSync(join(root, 'services/cli/package.json'), 'utf8')).version;
  const protocol = /CLI_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(readFileSync(join(root, 'services/contracts/src/cli-auth.ts'), 'utf8'))[1];
  const text = readFileSync(join(root, transition), 'utf8');
  expect(text).toContain(`\nAFBIN_VERSION=${version}\n`);
  expect(text).toContain(`\nAFBIN_PROTOCOL=${protocol}\n`);
});
