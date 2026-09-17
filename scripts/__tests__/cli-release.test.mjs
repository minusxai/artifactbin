import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');

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

for (const [level, next] of [['minor', '0.2.0'], ['major', '1.0.0'], ['patch', '0.1.10']]) {
  it(`a ${level} bump moves every copy of the version to ${next}`, () => {
    const dir = mkdtempSync(join(tmpdir(), `afbin-bump-${level}-`));
    try {
      mkdirSync(join(dir, 'services/cli'), { recursive: true });
      mkdirSync(join(dir, 'services/app/public/chat'), { recursive: true });
      writeFileSync(join(dir, 'services/cli/package.json'), '{"version": "0.1.9"}\n');
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'services/cli': { version: '0.1.9' } } }));
      writeFileSync(join(dir, 'services/app/public/chat/install.sh'), '  version=0.1.9\n--version 0.1.9\n');
      writeFileSync(join(dir, 'services/app/public/chat/release.json'), '{\n  "version": "0.1.9",\n  "protocol": 1\n}\n');
      const run = spawnSync(process.execPath, [join(root, 'scripts/bump-cli-version.mjs'), level], { cwd: dir });
      expect(run.status, run.stderr.toString()).toBe(0);
      expect(run.stdout.toString()).toContain(`afbin 0.1.9 → ${next}`);
      expect(JSON.parse(readFileSync(join(dir, 'services/cli/package.json'))).version).toBe(next);
      expect(JSON.parse(readFileSync(join(dir, 'package-lock.json'))).packages['services/cli'].version).toBe(next);
      expect(readFileSync(join(dir, 'services/app/public/chat/install.sh'), 'utf8')).toBe(`  version=${next}\n--version ${next}\n`);
      expect(JSON.parse(readFileSync(join(dir, 'services/app/public/chat/release.json'))).version).toBe(next);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

it('an unknown bump level is refused before any file changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'afbin-bump-level-'));
  try {
    mkdirSync(join(dir, 'services/cli'), { recursive: true });
    writeFileSync(join(dir, 'services/cli/package.json'), '{"version": "0.1.9"}\n');
    const run = spawnSync(process.execPath, [join(root, 'scripts/bump-cli-version.mjs'), 'huge'], { cwd: dir });
    expect(run.status).not.toBe(0);
    expect(run.stderr.toString()).toContain('patch, minor or major');
    expect(JSON.parse(readFileSync(join(dir, 'services/cli/package.json'))).version).toBe('0.1.9');
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
