import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import pty from 'node-pty';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const checkout = path.resolve(import.meta.dirname, '../..');
const script = path.join(checkout, 'services/app/public/chat/install.sh');
const version = JSON.parse(fs.readFileSync(path.join(checkout, 'services/cli/package.json'), 'utf8')).version;
let tmp, bin, home, target;

/**
 * A local release directory stands in for the published one, so the installer's own
 * download, checksum and replacement paths run unchanged from a clean home outside
 * this checkout. Assembling it here is not a published release.
 */
const publish = (release, payload, checksum = createHash('sha256').update(payload).digest('hex')) => {
  const dir = path.join(tmp, 'releases', release);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'afbin-darwin-arm64'), payload);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${checksum}  afbin-darwin-arm64\n`);
};
const installed = (dir) => spawnSync(path.join(dir, 'afbin'), [], { encoding: 'utf8' }).stdout;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afbin-install-test-'));
  bin = path.join(tmp, 'tools'); home = path.join(tmp, 'clean home'); target = path.join(tmp, 'install with spaces');
  fs.mkdirSync(bin); fs.mkdirSync(home);
  publish(version, '#!/bin/sh\necho afbin-test\n');
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
echo "curl $*" >> "$AFBIN_TEST_DIR/curl.log"
out=''; url=''; head=''
while [ "$#" -gt 0 ]; do
 case "$1" in -o|--output) out="$2"; shift;; -I|--head) head=1;; http://*|https://*) url="$1";; esac
 shift
done
release=\${url%/*}; release=\${release##*/afbin-v}
file=\${url##*/}
source="$AFBIN_TEST_DIR/releases/$release/$file"
if [ -n "$head" ]; then
 [ -f "$source" ] && printf 'HTTP/1.1 200 OK\r\ncontent-length: %s\r\n\r\n' "$(wc -c < "$source" | tr -d ' ')" || printf 'HTTP/1.1 404 Not Found\r\n\r\n'
 exit 0
fi
[ -f "$source" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
if [ -n "\${AFBIN_TEST_SLOW:-}" ]; then head -c 10 "$source" > "$out"; sleep 1.3; fi
cp "$source" "$out"
`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const baseEnv = () => ({ PATH: `${bin}:/usr/bin:/bin`, HOME: home, AFBIN_TEST_DIR: tmp });
const run = (args = [], { dir = target, env = {} } = {}) => spawnSync('sh', [script, ...(dir ? ['--dir', dir] : []), ...args], {
  encoding: 'utf8', cwd: home, env: { ...baseEnv(), ...env },
});
/** The same run inside a pseudo-terminal, where the installer may colour its output and show curl's progress bar. */
const runInTerminal = (args = [], env = {}, onData, piped = false) => new Promise((resolve, reject) => {
  let output = '';
  const child = pty.spawn('sh', piped ? ['-c', 'cat "$1" | sh -s -- --dir "$2"', 'installer-test', script, target] : [script, '--dir', target, ...args], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: home, env: { ...baseEnv(), TERM: 'xterm-256color', LANG: 'en_US.UTF-8', ...env },
  });
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Installer timed out: ' + output)); }, 20000);
  child.onData((data) => { output += data; onData?.(output, child); });
  child.onExit(({ exitCode }) => { clearTimeout(timeout); resolve({ status: exitCode, output }); });
});
const curlCalls = () => (fs.existsSync(path.join(tmp, 'curl.log')) ? fs.readFileSync(path.join(tmp, 'curl.log'), 'utf8').trim().split('\n') : []);
const ANSI = /\x1b\[/;
it('installs the verified executable without Node or sudo, including paths with spaces', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(installed(target)).toBe('afbin-test\n');
});
it('installs into a clean home outside the checkout by default, and names the version it pins', () => {
  const result = run([], { dir: null });
  expect(result.status, result.stderr).toBe(0);
  const destination = path.join(home, '.local', 'bin');
  expect(destination.startsWith(checkout)).toBe(false);
  expect(installed(destination)).toBe('afbin-test\n');
  expect(result.stdout).toContain(`Installed afbin ${version}`);
  expect(result.stdout).toContain('afbin help');
});
it('updates a working installation in place when a newer release is requested', () => {
  expect(run().status).toBe(0);
  publish('9.9.9', '#!/bin/sh\necho afbin-next\n');
  const update = run(['--version', '9.9.9']);
  expect(update.status, update.stderr).toBe(0);
  expect(installed(target)).toBe('afbin-next\n');
  expect(update.stdout).toContain('Installed afbin 9.9.9');
});
it('leaves the working installation untouched when an update has the wrong checksum', () => {
  expect(run().status).toBe(0);
  publish('9.9.9', '#!/bin/sh\necho tampered\n', createHash('sha256').update('something else').digest('hex'));
  const update = run(['--version', '9.9.9']);
  expect(update.status).not.toBe(0);
  expect(update.stderr).toContain('existing installation was not changed');
  expect(installed(target)).toBe('afbin-test\n');
  expect(fs.readdirSync(target)).toEqual(['afbin']);
});
it('leaves an existing install untouched when the download has the wrong checksum', () => {
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'afbin'), 'existing');
  publish(version, 'tampered', createHash('sha256').update('afbin').digest('hex'));
  expect(run().status).not.toBe(0);
  expect(fs.readFileSync(path.join(target, 'afbin'), 'utf8')).toBe('existing');
});
it('rejects invalid versions before installing', () => {
  expect(run(['--version', '../../unexpected']).status).not.toBe(0);
  expect(fs.existsSync(path.join(target, 'afbin'))).toBe(false);
});
it('rejects unsupported platforms clearly', () => {
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho unsupported\n', { mode: 0o755 });
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Unsupported');
});

it('checks the release before downloading, and stops when it has no build for this platform', () => {
  const dir = path.join(tmp, 'releases', version);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${createHash('sha256').update('x').digest('hex')}  afbin-linux-x64\n`);
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Release afbin-v${version} has no build for macOS arm64`);
  expect(curlCalls().some((line) => line.includes('afbin-darwin-arm64'))).toBe(false);
  expect(fs.existsSync(path.join(target, 'afbin'))).toBe(false);
});
it('fails fast when the release does not exist', () => {
  const result = run(['--version', '9.9.9']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('afbin-v9.9.9');
  expect(result.stderr).toContain('curl: (22) The requested URL returned error: 404');
  expect(curlCalls()).toHaveLength(1);
  expect(curlCalls()[0]).toContain('SHA256SUMS');
});
it('reports each step, the downloaded size and the time it took', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`afbin ${version}`);
  expect(result.stdout).toContain('Artifactbin: Google docs for agents');
  expect(result.stdout).toMatch(/^ {2}-{20,}$/m);
  expect(result.stdout).toMatch(/Release afbin-v\S+ has a macOS arm64 build/);
  expect(result.stdout).toMatch(/Downloading afbin-darwin-arm64 \(\d+ B\)/);
  expect(result.stdout).not.toMatch(/Downloaded .* in \d+s/);
  expect(result.stdout).toContain('Checksum verified');
  expect(result.stdout).toContain(`Installed afbin ${version} to ${target}/afbin`);
});
it('says when it replaced a previous installation', () => {
  expect(run().status).toBe(0);
  fs.writeFileSync(path.join(target, 'afbin'), 'stale');
  const again = run();
  expect(again.status, again.stderr).toBe(0);
  expect(again.stdout).toMatch(/Installed afbin \S+ to .*replaced the previous version/);
  expect(installed(target)).toBe('afbin-test\n');
});
it('skips the download when the installed afbin already is the requested release', () => {
  expect(run().status).toBe(0);
  fs.rmSync(path.join(tmp, 'curl.log'));
  const again = run();
  expect(again.status, again.stderr).toBe(0);
  expect(again.stdout).toContain(`afbin ${version} is already installed at ${target}/afbin`);
  expect(again.stdout).not.toMatch(/Downloading|Downloaded|Installed afbin/);
  expect(again.stdout).toContain('afbin help');
  expect(curlCalls().some((line) => line.includes('afbin-darwin-arm64'))).toBe(false);
});
it('keeps a verified copy in the cache and reinstalls from it without downloading', () => {
  expect(run().status).toBe(0);
  const cached = path.join(home, '.cache', 'afbin', `afbin-darwin-arm64-${version}`);
  expect(fs.readFileSync(cached, 'utf8')).toBe('#!/bin/sh\necho afbin-test\n');
  fs.rmSync(path.join(target, 'afbin')); fs.rmSync(path.join(tmp, 'curl.log'));
  const again = run();
  expect(again.status, again.stderr).toBe(0);
  expect(installed(target)).toBe('afbin-test\n');
  expect(again.stdout).toContain('Using the verified download in ~/.cache/afbin');
  expect(curlCalls().some((line) => line.includes('afbin-darwin-arm64'))).toBe(false);
  // A corrupted cache entry is ignored, re-downloaded and replaced.
  fs.writeFileSync(cached, 'garbage'); fs.rmSync(path.join(target, 'afbin')); fs.rmSync(path.join(tmp, 'curl.log'));
  const third = run();
  expect(third.status, third.stderr).toBe(0);
  expect(curlCalls().some((line) => line.includes('afbin-darwin-arm64'))).toBe(true);
  expect(fs.readFileSync(cached, 'utf8')).toBe('#!/bin/sh\necho afbin-test\n');
});
it('delegates setup and its output to the installed CLI, including repeat installs', () => {
  publish(version, '#!/bin/sh\necho "$*" >> "$HOME/setup-args"\nprintf "  Agent skills\\n    ✓ Claude Code  ~/.claude/skills/artifactbin\\n\\n  Restart Claude Code to load your new skills.\\n"\n');
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('    ✓ Claude Code  ~/.claude/skills/artifactbin');
  expect(result.stdout).toContain('Restart Claude Code to load your new skills.');
  expect(fs.readFileSync(path.join(home, 'setup-args'), 'utf8')).toBe('setup --yes\n');
  expect(run().status).toBe(0);
  expect(fs.readFileSync(path.join(home, 'setup-args'), 'utf8')).toBe('setup --yes\nsetup --yes\n');
});
it('keeps the executable and explains how to retry when setup fails', () => {
  publish(version, '#!/bin/sh\necho boom >&2\nexit 1\n');
  const broken = run();
  expect(broken.status, broken.stderr).toBe(0);
  expect(broken.stdout).toContain('Run afbin setup to finish choosing your agent skills.');
  expect(broken.stderr).toContain('boom');
  expect(fs.readFileSync(path.join(target, 'afbin'), 'utf8')).toContain('boom');
});
it('gives setup a terminal and passes --yes only when explicitly requested', async () => {
  publish(version, '#!/bin/sh\necho "$*" >> "$HOME/setup-args"\nif [ -t 0 ]; then echo terminal >> "$HOME/setup-args"; fi\n');
  expect((await runInTerminal()).status).toBe(0);
  expect(fs.readFileSync(path.join(home, 'setup-args'), 'utf8')).toBe('setup\nterminal\n');
  expect((await runInTerminal(['--yes'])).status).toBe(0);
  expect(fs.readFileSync(path.join(home, 'setup-args'), 'utf8')).toBe('setup\nterminal\nsetup --yes\n');
});
it('honours XDG_CACHE_HOME for the download cache', () => {
  const result = run([], { env: { XDG_CACHE_HOME: path.join(tmp, 'xdg cache') } });
  expect(result.status, result.stderr).toBe(0);
  expect(fs.existsSync(path.join(tmp, 'xdg cache', 'afbin', `afbin-darwin-arm64-${version}`))).toBe(true);
  expect(fs.existsSync(path.join(home, '.cache'))).toBe(false);
});
it('writes plain text without a terminal: no colour codes and no progress bar', () => {
  const result = run([], { env: { AFBIN_TEST_SLOW: '1' } });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toMatch(ANSI);
  expect(result.stderr).not.toMatch(ANSI);
  expect(`${result.stdout}${result.stderr}`).not.toMatch(/[\r\u2588%]/);
});
it('colours its output, draws a progress bar and hides the cursor while downloading in a terminal', async () => {
  const result = await runInTerminal([], { AFBIN_TEST_SLOW: '1' });
  expect(result.status, result.output).toBe(0);
  expect(result.output).toMatch(ANSI);
  expect(result.output).toContain('\u2713');
  expect(result.output).toContain('\u2500\u2500\u2500');
  expect(result.output).toContain('\u2588');
  expect(result.output).toMatch(/\d+%/);
  // 100 columns leave a 20-cell bar next to the label, sizes, speed and time left.
  expect(result.output).toMatch(/[\u2588\u2591]{20}\x1b\[0m \x1b\[1m {1,2}\d+%/);
  expect(result.output).toMatch(/\d+\/\d+ B/);
  expect(result.output).toMatch(/\d+ B\/s/);
  expect(result.output).toMatch(/\d+s left/);
  expect(result.output).toContain('\x1b[?25l');
  expect(result.output).toContain('\x1b[?25h');
  expect(result.output).toMatch(/Downloaded afbin-darwin-arm64 \(\d+ B\)/);
  expect(result.output).not.toMatch(/Downloaded .* in \d+s/);
  expect(result.output).toContain(`Installed afbin ${version}`);
});
it('respects NO_COLOR in a terminal and FORCE_COLOR without one', async () => {
  const plain = await runInTerminal([], { NO_COLOR: '1', AFBIN_TEST_SLOW: '1' });
  expect(plain.status, plain.output).toBe(0);
  expect(plain.output).not.toMatch(ANSI);
  expect(plain.output).toContain('\u2713');
  expect(plain.output).toContain('\u2588');
  const forced = run([], { env: { FORCE_COLOR: '1' } });
  expect(forced.status, forced.stderr).toBe(0);
  expect(forced.stdout).toMatch(ANSI);
});
it('gives shell-specific PATH advice only when the install directory is not on PATH', () => {
  const zsh = run([], { dir: null, env: { SHELL: '/bin/zsh' } });
  expect(zsh.status, zsh.stderr).toBe(0);
  expect(zsh.stdout).toContain('~/.local/bin is not on your PATH');
  expect(zsh.stdout).toContain('export PATH="$HOME/.local/bin:$PATH"');
  expect(zsh.stdout).toContain('>> ~/.zshrc');
  const fish = run([], { dir: null, env: { SHELL: '/opt/homebrew/bin/fish' } });
  expect(fish.stdout).toContain('fish_add_path ~/.local/bin');
  const onPath = run([], { dir: null, env: { PATH: `${path.join(home, '.local', 'bin')}:${bin}:/usr/bin:/bin` } });
  expect(onPath.status, onPath.stderr).toBe(0);
  expect(onPath.stdout).not.toContain('not on your PATH');
});
it('prints usage for --help and rejects unknown options', () => {
  const help = run(['--help']);
  expect(help.status).toBe(0);
  expect(help.stdout).toMatch(/install\.sh \[--version \S+\] \[--dir PATH\]/);
  expect(help.stdout).toContain('NO_COLOR');
  const bad = run(['--nope']);
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain('Unknown option: --nope');
  expect(curlCalls()).toHaveLength(0);
});

it('accepts a plain-http release base from a local server, and then stops demanding TLS', () => {
  // A local artifactbin serves its own build and rewrites the release base to its origin.
  const local = fs.readFileSync(script, 'utf8').replace('https://github.com/minusxai/artifactbin/releases/download/afbin-v$version', 'http://127.0.0.1:3030/chat/releases/afbin-v$version');
  expect(local).not.toBe(fs.readFileSync(script, 'utf8'));
  const localScript = path.join(tmp, 'local-install.sh'); fs.writeFileSync(localScript, local);
  const result = spawnSync('sh', [localScript, '--dir', target], { encoding: 'utf8', cwd: home, env: baseEnv() });
  expect(result.status, result.stderr).toBe(0);
  expect(installed(target)).toBe('afbin-test\n');
  expect(curlCalls().every((line) => line.includes('http://127.0.0.1:3030/chat/releases/afbin-v'))).toBe(true);
  expect(curlCalls().every((line) => !line.includes('--proto') && !line.includes('--tlsv1.2'))).toBe(true);
  fs.rmSync(path.join(tmp, 'curl.log'));
  expect(run().status).toBe(0);
  expect(curlCalls().every((line) => line.includes('--proto =https') && line.includes('--tlsv1.2'))).toBe(true);
});

it('a piped installer uses the real setup checklist and installs only the toggled selection', async () => {
  const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  const main = path.join(checkout, 'services/cli/src/main.ts');
  publish(version, `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(require.resolve('tsx'))} ${quote(main)} "$@"\n`);
  for (const name of ['claude', 'codex', 'pi', 'opencode']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  let answered = false;
  const result = await runInTerminal([], { TSX_TSCONFIG_PATH: path.join(checkout, 'tsconfig.json') }, (text, child) => {
    if (!answered && text.includes('OpenCode')) {
      answered = true;
      child.write(' \u001b[B \r'); // Uncheck Claude and Codex; keep pi and OpenCode.
    }
  }, true);
  expect(result.status, result.output).toBe(0);
  expect(answered).toBe(true);
  expect(result.output).toContain('Choose your agent skills');
  expect(result.output).toContain('Agent skills');
  for (const dir of ['.pi/agent/skills/artifactbin', '.config/opencode/skills/artifactbin']) expect(fs.existsSync(path.join(home, dir, 'SKILL.md'))).toBe(true);
  for (const dir of ['.claude/skills/artifactbin', '.codex/skills/artifactbin']) expect(fs.existsSync(path.join(home, dir))).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(home, '.artifactbin/settings.json'), 'utf8')).harnesses).toEqual(['pi', 'opencode']);
  expect(result.output).not.toContain('Restart ');
});
