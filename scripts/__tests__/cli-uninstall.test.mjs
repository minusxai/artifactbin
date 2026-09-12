import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const checkout = path.resolve(import.meta.dirname, '../..');
const script = path.join(checkout, 'services/app/public/chat/uninstall.sh');
const shells = ['sh', ...(fs.existsSync('/bin/dash') ? ['dash'] : [])];
let tmp, home, project;

const write = (file, content = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const manifest = { version: '0.1.9', source: 'afbin', files: { 'SKILL.md': 'abc' } };
const skill = (dir, managed = true) => {
  write(path.join(dir, 'SKILL.md'), '# artifactbin');
  if (managed) write(path.join(dir, '.afbin-skill.json'), JSON.stringify(manifest));
};
/** Everything install.sh and the CLI write for one user, next to files that must survive. */
const seed = (root = home, env = {}) => {
  const exe = path.join(env.dir ?? path.join(root, '.local', 'bin'), 'afbin');
  write(exe, '#!/bin/sh\necho afbin\n'); fs.chmodSync(exe, 0o755);
  const state = env.state ?? path.join(root, '.artifactbin');
  write(path.join(state, '.env'), 'ARTIFACTBIN_TOKEN=secret\n');
  write(path.join(state, 'servers', 'abc.env'), 'ARTIFACTBIN_TOKEN=secret\n');
  write(path.join(state, 'settings.json'), '{"harnesses":["claude"]}\n');
  write(path.join(state, 'process-lock.sqlite'), '');
  const cache = path.join(env.cache ?? path.join(root, '.cache'), 'afbin');
  write(path.join(cache, 'afbin-darwin-arm64-0.1.9'), 'binary');
  const skills = {
    claude: path.join(env.claude ?? path.join(root, '.claude'), 'skills', 'artifactbin'),
    codex: path.join(env.codex ?? path.join(root, '.codex'), 'skills', 'artifactbin'),
    pi: path.join(env.pi ?? path.join(root, '.pi', 'agent'), 'skills', 'artifactbin'),
    opencode: path.join(env.opencode ?? path.join(root, '.config', 'opencode'), 'skills', 'artifactbin'),
  };
  for (const dir of Object.values(skills)) skill(dir);
  return { exe, state, cache, skills };
};
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afbin-uninstall-test-'));
  home = path.join(tmp, 'clean home'); project = path.join(home, 'project');
  fs.mkdirSync(project, { recursive: true });
  write(path.join(project, 'afbin.lock'), '{}'); write(path.join(project, 'report.jsx'), '---\n---\n');
  skill(path.join(home, '.claude', 'skills', 'other-skill'), false);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const run = (args = [], env = {}, shell = 'sh') => spawnSync(shell, [script, ...args], {
  encoding: 'utf8', cwd: project, env: { PATH: '/usr/bin:/bin', HOME: home, ...env },
});
const output = (result) => `${result.stdout}${result.stderr}`;

it('is a POSIX shell script that every listed shell parses', () => {
  expect(fs.readFileSync(script, 'utf8').startsWith('#!/bin/sh\n')).toBe(true);
  for (const shell of shells) expect(spawnSync(shell, ['-n', script], { encoding: 'utf8' }).status, shell).toBe(0);
});

it.each(shells)('removes the executable, sign-in state and managed skills, and nothing else (%s)', (shell) => {
  const { exe, state, cache, skills } = seed();
  const result = run([], {}, shell);
  expect(result.status, result.stderr).toBe(0);
  for (const gone of [exe, state, cache, ...Object.values(skills)]) {
    expect(fs.existsSync(gone), gone).toBe(false);
    expect(result.stdout).toContain(`Removed ${gone}`);
  }
  expect(fs.existsSync(path.join(home, '.local', 'bin'))).toBe(true);
  expect(fs.existsSync(path.join(home, '.claude', 'skills', 'other-skill', 'SKILL.md'))).toBe(true);
  expect(snapshot(project)).toEqual(['afbin.lock', 'report.jsx']);
  expect(result.stdout).toMatch(/afbin\.lock/);
  expect(result.stdout).not.toMatch(/Nothing to remove/);
});

it('honors --dir, ARTIFACTBIN_HOME and each harness directory override, leaving the defaults alone', () => {
  const defaults = seed();
  const custom = seed(tmp, {
    dir: path.join(tmp, 'install with spaces'), state: path.join(tmp, 'state'), cache: path.join(tmp, 'xdg cache'),
    claude: path.join(tmp, 'claude cfg'), codex: path.join(tmp, 'codex'), pi: path.join(tmp, 'pi'), opencode: path.join(tmp, 'opencode'),
  });
  const result = run(['--dir', path.join(tmp, 'install with spaces')], {
    ARTIFACTBIN_HOME: custom.state, XDG_CACHE_HOME: path.join(tmp, 'xdg cache'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude cfg'), CODEX_HOME: path.join(tmp, 'codex'),
    PI_CODING_AGENT_DIR: path.join(tmp, 'pi'), OPENCODE_CONFIG_DIR: path.join(tmp, 'opencode'),
  });
  expect(result.status, result.stderr).toBe(0);
  for (const gone of [custom.exe, custom.state, custom.cache, ...Object.values(custom.skills)]) expect(fs.existsSync(gone), gone).toBe(false);
  for (const kept of [defaults.exe, defaults.state, defaults.cache, ...Object.values(defaults.skills)]) expect(fs.existsSync(kept), kept).toBe(true);
});

it('finds the OpenCode skill under XDG_CONFIG_HOME when no OpenCode directory is set', () => {
  const dir = path.join(tmp, 'xdg', 'opencode', 'skills', 'artifactbin');
  skill(dir);
  const result = run([], { XDG_CONFIG_HOME: path.join(tmp, 'xdg') });
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(dir)).toBe(false);
});

it('leaves a skill directory afbin does not manage, and says so', () => {
  const unmanaged = path.join(home, '.claude', 'skills', 'artifactbin');
  skill(unmanaged, false);
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(path.join(unmanaged, 'SKILL.md'))).toBe(true);
  expect(result.stdout).toContain(`Left ${unmanaged} in place: not managed by afbin.`);
});

it('removes a managed skill reached through a symlinked directory, link included', () => {
  const physical = path.join(tmp, 'dotfiles', 'artifactbin');
  skill(physical);
  const link = path.join(home, '.claude', 'skills', 'artifactbin');
  fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(physical, link);
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(physical)).toBe(false);
  expect(fs.lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
});

it('--keep-state keeps sign-in and settings while removing the rest', () => {
  const { exe, state, cache, skills } = seed();
  const result = run(['--keep-state']);
  expect(result.status, result.stderr).toBe(0);
  expect(fs.readFileSync(path.join(state, '.env'), 'utf8')).toBe('ARTIFACTBIN_TOKEN=secret\n');
  expect(fs.existsSync(path.join(cache, 'afbin-darwin-arm64-0.1.9'))).toBe(true);
  expect(result.stdout).toContain(`Kept ${cache}`);
  expect(fs.existsSync(path.join(state, 'settings.json'))).toBe(true);
  for (const gone of [exe, ...Object.values(skills)]) expect(fs.existsSync(gone), gone).toBe(false);
  expect(result.stdout).toContain(`Kept ${state}`);
});

it('--dry-run changes nothing and lists what a real run would remove', () => {
  const { exe, state, cache, skills } = seed();
  const before = snapshot(home);
  const result = run(['--dry-run']);
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(home)).toEqual(before);
  for (const target of [exe, state, cache, ...Object.values(skills)]) expect(result.stdout).toContain(`Would remove ${target}`);
  expect(result.stdout).not.toContain('Removed ');
  expect(result.stdout).toMatch(/Dry run/);
});

it('keeps the backups afbin made of skills it replaced', () => {
  const { state } = seed();
  const backup = path.join(state, 'skill-backups', 'claude-1234', 'SKILL.md');
  write(backup, '# my own skill');
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(fs.readFileSync(backup, 'utf8')).toBe('# my own skill');
  for (const gone of ['.env', 'servers', 'settings.json', 'process-lock.sqlite']) expect(fs.existsSync(path.join(state, gone)), gone).toBe(false);
  expect(result.stdout).toContain(`Kept ${path.join(state, 'skill-backups')}`);
});

it('removes an empty skill-backups directory along with the state directory', () => {
  const { state } = seed();
  fs.mkdirSync(path.join(state, 'skill-backups'));
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(state)).toBe(false);
});

it('reports afbin copies it did not install without removing them', () => {
  const other = path.join(tmp, 'other bin'); write(path.join(other, 'afbin'), '#!/bin/sh\n');
  const linked = path.join(tmp, 'npm bin'); fs.mkdirSync(linked); fs.symlinkSync(path.join(other, 'afbin'), path.join(linked, 'afbin'));
  const local = path.join(home, '.local', 'bin', 'afbin'); fs.mkdirSync(path.dirname(local), { recursive: true }); fs.symlinkSync(path.join(other, 'afbin'), local);
  const result = run([], { PATH: `${other}:${linked}:${path.dirname(local)}:/usr/bin:/bin` });
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(path.join(other, 'afbin'))).toBe(true);
  expect(fs.lstatSync(path.join(linked, 'afbin')).isSymbolicLink()).toBe(true);
  expect(fs.lstatSync(local).isSymbolicLink()).toBe(true);
  expect(result.stdout).toContain(`Left ${local} in place: a symlink, not installed by install.sh.`);
  expect(result.stdout).toContain(`Another afbin remains at ${path.join(other, 'afbin')}`);
  expect(result.stdout).toContain(`Another afbin remains at ${path.join(linked, 'afbin')} (symlink to ${path.join(other, 'afbin')})`);
  expect(result.stdout).toMatch(/Nothing to remove/);
});

it('exits 0 with a clear message when nothing is installed', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Nothing to remove/);
});

it('rejects unknown options and a missing --dir value, and prints usage for --help', () => {
  seed();
  for (const args of [['--nope'], ['--dir'], ['--keep-login']]) {
    const result = run(args);
    expect(result.status, args.join(' ')).toBe(1);
    expect(result.stderr).toMatch(/Unknown option|Missing value/);
  }
  const help = run(['--help']);
  expect(help.status).toBe(0);
  expect(help.stdout).toMatch(/uninstall\.sh \[--dir PATH\] \[--keep-state\] \[--dry-run\]/);
  expect(fs.existsSync(path.join(home, '.local', 'bin', 'afbin'))).toBe(true);
});
