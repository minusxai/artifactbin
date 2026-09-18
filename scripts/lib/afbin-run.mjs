/**
 * `npm run afbin -- <args>` — THE BRANCH'S CLI AGAINST THIS CHECKOUT'S DEV SERVER.
 *
 * Until this existed, trying a CLI or skill change meant releasing it and deploying,
 * or running `node services/cli/dist/afbin.mjs` by hand with an ad-hoc `HOME` — and
 * forgetting the `HOME` rewrote the operator's real `~/.claude/skills/artifactbin`
 * from an unreleased build (twice in one day). So the three things that made it
 * dangerous are decided HERE, once, and none of them is left to the caller:
 *
 *   - the PORT comes from the same resolver `npm run dev` uses (`dev-env.mjs`), so a
 *     worktree's `.env` block points its own CLI at its own server;
 *   - the STATE lives in `~/.artifactbin-dev/<port>`, never `~/.artifactbin`, and no
 *     credential exported in the shell for production follows the child in;
 *   - SKILLS are switched off (`ARTIFACTBIN_SKILLS=off`), so eager init writes into
 *     no harness folder at all.
 *
 * The build is refreshed when it is older than the sources, because the whole point
 * is to run the branch's CLI rather than whatever was last compiled.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { resolvePort } from './dev-env.mjs';

/** The repository root, from this file. */
export const ROOT = path.resolve(import.meta.dirname, '../..');

/** The bind port, by exactly the rule `npm run dev` follows. */
export function afbinPort(env = process.env) { return resolvePort(env); }

/** One disposable CLI home PER SERVER, so two checkouts never share a connection. */
export function devHome(port, home = homedir()) { return path.join(home, '.artifactbin-dev', String(port)); }

/** The built entry this script runs, and the trees it is built from. */
const distEntry = (root) => path.join(root, 'services', 'cli', 'dist', 'afbin.mjs');
const sourceRoots = (root) => ['src', 'scripts'].map((dir) => path.join(root, 'services', 'cli', dir));

async function newestMtime(dir) {
  let newest = 0;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return newest; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(full));
    else {
      try { newest = Math.max(newest, (await stat(full)).mtimeMs); } catch { /* raced away */ }
    }
  }
  return newest;
}

/** True when `dist/afbin.mjs` is missing or older than any CLI source. */
export async function cliBuildStale(root = ROOT) {
  let built;
  try { built = (await stat(distEntry(root))).mtimeMs; } catch { return true; }
  for (const dir of sourceRoots(root)) if (await newestMtime(dir) > built) return true;
  return false;
}

/** ONE LINE. The reader needs the command and the port, not a stack. */
export function healthRefusal(port) {
  return `[afbin] No dev server is answering http://localhost:${port}/api/health — start it with: npm run dev (this checkout's port is ${port}; APP__PORT in .env selects it).`;
}

/** The child's environment: the dev home, skills off, and no production credential carried in. */
export function afbinChildEnv(env, port, home) {
  const child = { ...env, ARTIFACTBIN_HOME: devHome(port, home), ARTIFACTBIN_SKILLS: 'off' };
  for (const name of ['ARTIFACTBIN_URL', 'ARTIFACTBIN_TOKEN', 'ARTIFACTBIN_REFRESH_TOKEN', 'ARTIFACTBIN_CLIENT_ID', 'ARTIFACTBIN_EXPIRES_AT']) delete child[name];
  return child;
}

async function serverHealthy(port, fetchImpl) {
  try {
    const response = await fetchImpl(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch { return false; }
}

/** `npm run build -w services/cli`, inheriting the terminal so its output is the operator's. */
function buildCli(root) {
  const built = spawnSync('npm', ['run', 'build', '-w', 'services/cli'], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) throw new Error(`Building services/cli failed (${built.status ?? built.signal}).`);
}

/** Forward argv, stdio and the exit code to the branch's CLI. */
function execCli(file, args, options) {
  // The dev home is this runner's to own, so it exists before the CLI is asked to use it.
  mkdirSync(options.env.ARTIFACTBIN_HOME, { recursive: true, mode: 0o700 });
  const child = spawnSync(file, args, options);
  if (child.error) throw child.error;
  return child.signal ? 1 : (child.status ?? 1);
}

export async function runAfbin({
  argv,
  env = process.env,
  root = ROOT,
  home = homedir(),
  fetchImpl = fetch,
  spawnImpl = execCli,
  build = buildCli,
  log = console.error,
} = {}) {
  const port = afbinPort(env);
  if (!await serverHealthy(port, fetchImpl)) { log(healthRefusal(port)); return 1; }
  if (await cliBuildStale(root)) await build(root);
  const childEnv = afbinChildEnv(env, port, home);
  // A `--server` of our own, appended: the dev loop never talks to the default server.
  const args = [distEntry(root), ...argv, '--server', `http://localhost:${port}`];
  return spawnImpl(execPathOf(env), args, { stdio: 'inherit', env: childEnv });
}

/** The Node that runs this script runs the CLI too; nothing else is on the path for sure. */
function execPathOf(env) { return env.npm_node_execpath ?? process.execPath; }
