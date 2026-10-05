import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const checkout = path.resolve(import.meta.dirname, '../..');
const script = path.join(checkout, 'services/app/public/chat/uninstall.sh');
const shells = ['sh', ...(fs.existsSync('/bin/dash') ? ['dash'] : [])];
let tmp, home, project, stubs, npmArgs;

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
  // A stub npm first on PATH: the script must never reach a real global npm.
  stubs = path.join(tmp, 'stub bin'); npmArgs = path.join(tmp, 'npm-args');
  write(path.join(stubs, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$AFBIN_TEST_NPM_ARGS"\n'); fs.chmodSync(path.join(stubs, 'npm'), 0o755);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const shellPath = (shell) => (fs.existsSync(`/bin/${shell}`) ? `/bin/${shell}` : shell);
/** A PATH holding only the utilities the script uses, so no npm is reachable. */
const npmFreePath = () => {
  const dir = path.join(tmp, 'no npm bin'); fs.mkdirSync(dir, { recursive: true });
  for (const tool of ['rm', 'ls', 'readlink', 'cat']) {
    const found = ['/bin', '/usr/bin'].map((d) => path.join(d, tool)).find((f) => fs.existsSync(f));
    if (found) fs.symlinkSync(found, path.join(dir, tool));
  }
  return dir;
};
const run = (args = [], env = {}, shell = 'sh') => {
  const { PATH = '/usr/bin:/bin', noNpm = false, ...rest } = env;
  return spawnSync(shellPath(shell), [script, ...args], {
    encoding: 'utf8', cwd: project,
    env: { PATH: noNpm ? npmFreePath() : `${stubs}:${PATH}`, HOME: home, AFBIN_TEST_NPM_ARGS: npmArgs, ...rest },
  });
};
/** What the npm setup path and the retired standalone executable leave under the state directory. */
const seedNpm = (state) => {
  const prefix = path.join(state, 'npm');
  write(path.join(prefix, 'lib', 'node_modules', '@afbin', 'cli', 'package.json'), '{"name":"@afbin/cli"}');
  write(path.join(prefix, 'bin', 'afbin'), '#!/bin/sh\n');
  const standalone = path.join(state, 'backups', 'standalone');
  write(path.join(standalone, 'afbin-0.3.21'), 'old binary');
  return { prefix, standalone };
};
const keptLine = (state) => `Kept ${state} (sign-in and settings) and agent skills. Use --purge to remove them.`;

it('is a POSIX shell script that every listed shell parses', () => {
  expect(fs.readFileSync(script, 'utf8').startsWith('#!/bin/sh\n')).toBe(true);
  for (const shell of shells) expect(spawnSync(shell, ['-n', script], { encoding: 'utf8' }).status, shell).toBe(0);
});

it.each(shells)('by default removes the executables and downloads but keeps sign-in, settings and skills (%s)', (shell) => {
  const { exe, state, cache, skills } = seed();
  const { prefix, standalone } = seedNpm(state);
  const result = run([], {}, shell);
  expect(result.status, result.stderr).toBe(0);
  for (const gone of [exe, cache, prefix, standalone]) {
    expect(fs.existsSync(gone), gone).toBe(false);
    expect(result.stdout).toContain(`Removed ${gone}`);
  }
  expect(fs.readFileSync(path.join(state, '.env'), 'utf8')).toBe('ARTIFACTBIN_TOKEN=secret\n');
  for (const kept of ['servers/abc.env', 'settings.json', 'process-lock.sqlite']) expect(fs.existsSync(path.join(state, kept)), kept).toBe(true);
  for (const dir of Object.values(skills)) {
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe('# artifactbin');
    expect(fs.existsSync(path.join(dir, '.afbin-skill.json')), dir).toBe(true);
  }
  expect(fs.readFileSync(npmArgs, 'utf8')).toBe('uninstall\n-g\n@afbin/cli\n');
  expect(result.stdout).toContain(keptLine(state));
  expect(result.stdout).not.toContain(`Removed ${state} `);
  expect(fs.existsSync(path.join(home, '.claude', 'skills', 'other-skill', 'SKILL.md'))).toBe(true);
  expect(snapshot(project)).toEqual(['afbin.lock', 'report.jsx']);
});

it('reports skipping the npm uninstall when npm is not on PATH', () => {
  const { exe, state } = seed();
  const result = run([], { noNpm: true });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Skipped npm uninstall: npm not found');
  expect(fs.existsSync(exe)).toBe(false);
  expect(fs.existsSync(npmArgs)).toBe(false);
  expect(fs.existsSync(path.join(state, '.env'))).toBe(true);
});

it.each(shells)('--purge removes the executable, sign-in state and managed skills, and nothing else (%s)', (shell) => {
  const { exe, state, cache, skills } = seed();
  seedNpm(state);
  const result = run(['--purge'], {}, shell);
  expect(result.status, result.stderr).toBe(0);
  for (const gone of [exe, state, cache, ...Object.values(skills)]) {
    expect(fs.existsSync(gone), gone).toBe(false);
    expect(result.stdout).toContain(`Removed ${gone}`);
  }
  expect(fs.readFileSync(npmArgs, 'utf8')).toBe('uninstall\n-g\n@afbin/cli\n');
  expect(fs.existsSync(path.join(home, '.local', 'bin'))).toBe(true);
  expect(fs.existsSync(path.join(home, '.claude', 'skills', 'other-skill', 'SKILL.md'))).toBe(true);
  expect(snapshot(project)).toEqual(['afbin.lock', 'report.jsx']);
  expect(result.stdout).toMatch(/afbin\.lock/);
  expect(result.stdout).not.toContain('Use --purge');
  expect(result.stdout).not.toMatch(/Nothing to remove/);
});

it('honors --dir, ARTIFACTBIN_HOME and each harness directory override, leaving the defaults alone', () => {
  const defaults = seed();
  const custom = seed(tmp, {
    dir: path.join(tmp, 'install with spaces'), state: path.join(tmp, 'state'), cache: path.join(tmp, 'xdg cache'),
    claude: path.join(tmp, 'claude cfg'), codex: path.join(tmp, 'codex'), pi: path.join(tmp, 'pi'), opencode: path.join(tmp, 'opencode'),
  });
  const result = run(['--purge', '--dir', path.join(tmp, 'install with spaces')], {
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
  const result = run(['--purge'], { XDG_CONFIG_HOME: path.join(tmp, 'xdg') });
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(dir)).toBe(false);
});

it('leaves a skill directory afbin does not manage, and says so', () => {
  const unmanaged = path.join(home, '.claude', 'skills', 'artifactbin');
  skill(unmanaged, false);
  const result = run(['--purge']);
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(path.join(unmanaged, 'SKILL.md'))).toBe(true);
  expect(result.stdout).toContain(`Left ${unmanaged} in place: not managed by afbin.`);
});

it('removes a managed skill reached through a symlinked directory, link included', () => {
  const physical = path.join(tmp, 'dotfiles', 'artifactbin');
  skill(physical);
  const link = path.join(home, '.claude', 'skills', 'artifactbin');
  fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(physical, link);
  const result = run(['--purge']);
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(physical)).toBe(false);
  expect(fs.lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
});

it('accepts --keep-state as a no-op: the result equals the default run', () => {
  const plain = seed(), plainNpm = seedNpm(plain.state);
  const other = path.join(tmp, 'other home'); fs.mkdirSync(other);
  skill(path.join(other, '.claude', 'skills', 'other-skill'), false);
  const flagged = seed(other), flaggedNpm = seedNpm(flagged.state);
  const a = run([]);
  const b = run(['--keep-state'], { HOME: other });
  expect(a.status, a.stderr).toBe(0); expect(b.status, b.stderr).toBe(0);
  expect(snapshot(other).filter((entry) => !entry.startsWith('project'))).toEqual(snapshot(home).filter((entry) => !entry.startsWith('project')));
  for (const gone of [flagged.exe, flagged.cache, flaggedNpm.prefix, flaggedNpm.standalone]) expect(fs.existsSync(gone), gone).toBe(false);
  for (const kept of [flagged.state, ...Object.values(flagged.skills)]) expect(fs.existsSync(kept), kept).toBe(true);
  expect(b.stdout).toContain(keptLine(flagged.state));
  expect(fs.existsSync(plainNpm.prefix)).toBe(false);
});

it('--dry-run changes nothing and lists what a real run would remove', () => {
  const { exe, state, cache, skills } = seed();
  const { prefix, standalone } = seedNpm(state);
  const before = snapshot(home);
  const result = run(['--dry-run']);
  expect(result.status, result.stderr).toBe(0);
  expect(snapshot(home)).toEqual(before);
  for (const target of [exe, cache, prefix, standalone]) expect(result.stdout).toContain(`Would remove ${target}`);
  for (const kept of [state, ...Object.values(skills)]) expect(result.stdout).not.toContain(`Would remove ${kept} `);
  expect(result.stdout).toContain('Would run npm uninstall -g @afbin/cli');
  expect(fs.existsSync(npmArgs)).toBe(false);
  expect(result.stdout).not.toContain('Removed ');
  expect(result.stdout).toMatch(/Dry run/);
  const purge = run(['--dry-run', '--purge']);
  expect(purge.status, purge.stderr).toBe(0);
  expect(snapshot(home)).toEqual(before);
  for (const target of [exe, state, cache, ...Object.values(skills)]) expect(purge.stdout).toContain(`Would remove ${target}`);
  expect(purge.stdout).not.toContain('Removed ');
});

it('keeps the backups afbin made of skills it replaced', () => {
  const { state } = seed();
  const backup = path.join(state, 'skill-backups', 'claude-1234', 'SKILL.md');
  write(backup, '# my own skill');
  const result = run(['--purge']);
  expect(result.status, result.stderr).toBe(0);
  expect(fs.readFileSync(backup, 'utf8')).toBe('# my own skill');
  for (const gone of ['.env', 'servers', 'settings.json', 'process-lock.sqlite']) expect(fs.existsSync(path.join(state, gone)), gone).toBe(false);
  expect(result.stdout).toContain(`Kept ${path.join(state, 'skill-backups')}`);
});

it('removes an empty skill-backups directory along with the state directory', () => {
  const { state } = seed();
  fs.mkdirSync(path.join(state, 'skill-backups'));
  const result = run(['--purge']);
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
  expect(result.stdout).not.toContain('Use --purge');
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
  expect(help.stdout).toMatch(/uninstall\.sh \[--dir PATH\] \[--purge\] \[--dry-run\]/);
  expect(help.stdout).toMatch(/--purge/);
  expect(fs.existsSync(path.join(home, '.local', 'bin', 'afbin'))).toBe(true);
  expect(fs.existsSync(npmArgs)).toBe(false);
});
