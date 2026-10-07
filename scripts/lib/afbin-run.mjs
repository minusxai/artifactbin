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
 *     worktree's `.env` block points its own CLI at its own server, by the origin that
 *     server calls itself (`afbinServer`);
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

import { buildAfbinDev } from './afbin-build.mjs';
import { resolvePort } from './dev-env.mjs';

/** The repository root, from this file. */
export const ROOT = path.resolve(import.meta.dirname, '../..');

/** The bind port, by exactly the rule `npm run dev` follows. */
export function afbinPort(env = process.env) { return resolvePort(env); }

/** One disposable CLI home PER SERVER, so two checkouts never share a connection. */
export function devHome(port, home = homedir()) { return path.join(home, '.artifactbin-dev', String(port)); }

/** The built entry this script runs, and the trees it is built from. */
const distEntry = (root) => path.join(root, 'services', 'cli', 'dist', 'afbin.mjs');
// The CLI bundles more than its own tree: app/lib (validation, the markup and map
// contracts) and the shared packages. A change there is a change to the CLI.
const sourceRoots = (root) => [
  ...[['cli', 'src'], ['app', 'lib'], ['utils', 'src'], ['contracts', 'src'], ['sql', 'src']]
    .map((dir) => path.join(root, 'services', ...dir)),
  ...['services/cli/scripts/bundle-options.mjs', 'services/cli/package.json', 'services/cli/npm-shrinkwrap.json',
    'package.json', 'package-lock.json', 'scripts/lib/afbin-build.mjs']
    .map((file) => path.join(root, file)),
];

const runtimePath = (root) => path.join(root, 'services', 'cli', 'dist', 'runtime');
const runtimeOutputs = (root) => [
  'bootstrap.cjs',
  'host.mjs',
  'preview.mjs',
  'preview/client.js',
  'preview/connect.js',
  'preview/chrome.css',
  'preview/fonts.css',
  'public/islands/manifest.json',
  'lib/build-assets/offline/manifest.json',
  'dist/web/solid-app.html',
  'package.json',
].map((file) => path.join(runtimePath(root), file));
// Inputs used by build-host: the CLI's host entries, app host/browser code and assets,
// plus shared server packages. Tests and unrelated app tooling do not invalidate it.
const runtimeSourceRoots = (root) => [
  ...[['app', 'app'], ['app', 'server'], ['app', 'lib'], ['app', 'solid'], ['app', 'skills'], ['app', 'orchestrator'], ['app', 'public'],
    ['cli', 'src'], ['utils', 'src'], ['contracts', 'src'], ['sql', 'src'], ['auth', 'src'], ['browser', 'src'], ['events', 'src']]
    .map((dir) => path.join(root, 'services', ...dir)),
  ...['services/cli/scripts/build.mjs', 'services/cli/scripts/build-host.mjs', 'services/cli/scripts/build-preview.mjs',
    'services/cli/scripts/bundle-options.mjs', 'services/app/scripts/build-prep.mjs', 'services/app/scripts/build-server-reader.mjs',
    'services/app/scripts/build-offline.mjs', 'services/app/scripts/build-libraries.mjs', 'services/app/scripts/copy-assets.mjs',
    'services/app/package.json', 'services/cli/package.json', 'services/cli/npm-shrinkwrap.json', 'package.json', 'package-lock.json',
    'services/contracts/package.json', 'services/utils/package.json', 'services/sql/package.json', 'services/auth/package.json',
    'services/browser/package.json', 'services/events/package.json', 'scripts/build/build-server.mjs',
    'scripts/build/build-islands.mjs', 'scripts/build/runtime-externals.mjs', 'scripts/build/copy-runner-assets.mjs',
    'scripts/lib/generate-teaching.mjs', 'vite.config.mts']
    .map((file) => path.join(root, file)),
];
const nonBuildInputs = (file) => file.split(path.sep).some(part => ['__tests__', '__fixtures__', 'test', 'tests', 'fixtures'].includes(part));

async function newestMtime(dir, ignored = () => false) {
  let newest = 0;
  let info;
  try { info = await stat(dir); } catch { return newest; }
  if (info.isFile()) return info.mtimeMs;
  if (!info.isDirectory()) return newest;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return newest; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (ignored(full)) continue;
    if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(full, ignored));
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
  for (const dir of sourceRoots(root)) if (await newestMtime(dir, nonBuildInputs) > built) return true;
  return false;
}

/** A runtime is usable only when complete and no host input changed after its final bootstrap write. */
export async function hostRuntimeState(root = ROOT) {
  for (const output of runtimeOutputs(root)) {
    try { if (!(await stat(output)).isFile()) throw new Error('not a file'); }
    catch { return { available: false, reason: `missing packaged runtime output ${path.relative(root, output)}` }; }
  }
  let built;
  try { built = (await stat(path.join(runtimePath(root), 'bootstrap.cjs'))).mtimeMs; }
  catch { return { available: false, reason: 'missing packaged runtime bootstrap' }; }
  for (const dir of runtimeSourceRoots(root)) {
    const newest = await newestMtime(dir, nonBuildInputs);
    if (newest > built) return { available: false, reason: `stale packaged runtime; ${path.relative(root, dir)} changed after its build` };
  }
  return { available: true };
}

/** Only commands that actually execute the local packaged host need that host runtime. */
export async function requiresHostRuntime(argv, cwd = process.cwd()) {
  if (argv.includes('--help') || argv.includes('-h') || argv.includes('--version')) return false;
  const command = argv[0];
  if (command === 'preview' || command === 'serve') return true;
  if (command !== 'export' || argv.includes('--dry-run')) return false;

  const values = new Map();
  const operands = [];
  let positionalOnly = false;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (positionalOnly) { operands.push(arg); continue; }
    if (arg === '--') { positionalOnly = true; continue; }
    if (!arg.startsWith('-')) { operands.push(arg); continue; }
    const match = /^--(format|output|type|name|page)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    const name = match[1];
    const value = match[2] ?? argv[++index];
    if (value !== undefined) values.set(name, value);
  }
  if (values.has('name') || argv.includes('--refresh')) return false;
  const output = values.get('output');
  const extension = typeof output === 'string' && output !== '-'
    ? path.extname(output).toLowerCase().slice(1) : '';
  const inferred = ({ jpeg: 'jpg', yml: 'yaml' })[extension] ?? extension;
  const format = values.get('format') ?? inferred;
  if (!['html', 'png', 'jpg'].includes(format)) return false;
  if (values.has('format') && inferred && inferred !== format && operands.length === 1) return false;
  for (const operand of operands) {
    // A fully qualified artifact URL always goes through serverRenderer. A bare
    // ID can also resolve through local workspace identity, so require the host
    // runtime unless --refresh above selected the server route explicitly.
    if (/^https?:\/\//i.test(operand)) continue;
    // `file@N` is accepted as a local path when the file itself exists.
    const candidate = operand.match(/^(.+)@\d+$/)?.[1] ?? operand;
    try { if ((await stat(path.resolve(cwd, candidate))).isFile()) return true; }
    catch { /* An unresolved bare reference may be a local workspace ID. */ }
    if (/^[a-z0-9_-]{6,}$/i.test(candidate)) return true;
  }
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

/** The FAST dev bundle uses the canonical CLI compiler options and skips package assembly. */
function buildCli(root) { return buildAfbinDev(root); }

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
  cwd = process.cwd(),
  fetchImpl = fetch,
  spawnImpl = execCli,
  build = buildCli,
  log = console.error,
} = {}) {
  const port = afbinPort(env);
  if (!await serverHealthy(port, fetchImpl)) { log(healthRefusal(port)); return 1; }
  if (await requiresHostRuntime(argv, cwd)) {
    const runtime = await hostRuntimeState(root);
    if (!runtime.available) {
      log(`[afbin] This command needs the current checkout's packaged host runtime, but ${runtime.reason}. Use a CI-built checkout or artifact containing this runtime; for published renders, pass a full artifact URL or use --refresh.`);
      return 1;
    }
  }
  if (await cliBuildStale(root)) await build(root);
  const childEnv = afbinChildEnv(env, port, home);
  const flags = serverFlag(argv, afbinServer(env, port));
  const args = [distEntry(root), ...(argv[0] === 'remote' ? [argv[0], ...flags, ...argv.slice(1)] : [...argv, ...flags])];
  return spawnImpl(execPathOf(env), args, { stdio: 'inherit', env: childEnv });
}

/**
 * The origin the CLI selects: the one this checkout's server calls itself. With
 * APP__PAGES_HOST set the app serves at APP__PUBLIC_BASE_URL (`http://app.lvh.me:<port>`)
 * and advertises its approval page there, so a CLI pointed at `localhost` would refuse
 * the pairing as another origin (approval_origin_mismatch). Without it, `localhost`.
 * @param {Record<string, string | undefined>} env
 * @param {number} port
 */
export function afbinServer(env, port) {
  if (env.APP__PAGES_HOST?.trim()) {
    try {
      const origin = new URL(env.APP__PUBLIC_BASE_URL ?? '').origin;
      if (origin !== 'null') return origin;
    } catch { /* no usable public base URL: this checkout's localhost */ }
  }
  return `http://localhost:${port}`;
}

/**
 * This checkout's server, UNLESS the caller named one. Pointing the branch CLI at another
 * checkout's server (or a throwaway) is a legitimate thing to ask for, and an appended flag
 * that silently overrode it would make the request look honoured while it was not.
 * @param {readonly string[]} argv
 * @param {string} server
 */
export function serverFlag(argv, server) {
  // serve owns a server; the CLI refuses a client-only --server on this command.
  if (argv[0] === 'serve') return [];
  let options = argv;
  if (argv[0] === 'remote') {
    let end = 1;
    const values = new Set(['--name','--history','--session','--stop','--ready','--server']);
    while (end < argv.length && argv[end].startsWith('-')) {
      const arg = argv[end++];
      if (values.has(arg)) end++;
    }
    options = argv.slice(0, end);
  }
  const chosen = options.some((arg) => arg === '--server' || arg.startsWith('--server='));
  return chosen ? [] : ['--server', server];
}

/** The Node that runs this script runs the CLI too; nothing else is on the path for sure. */
function execPathOf(env) { return env.npm_node_execpath ?? process.execPath; }
