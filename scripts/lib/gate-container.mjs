/**
 * The pure half of scripts/gate-container.mjs — arguments, the image, the dependency volume and the
 * `docker run` line — so each can be tested without a container engine.
 */
import { createHash } from 'node:crypto';

/** What a container asks for unless told otherwise: the shape of one CI gate runner (4 vCPUs). */
export const DEFAULT_CPUS = 4;
export const DEFAULT_MEMORY = '8g';

/**
 * Gates that cannot run inside a gate container, and why. Each is still run by PR CI; the runner
 * refuses them by name instead of failing them for a reason that says nothing about the product.
 */
export const CONTAINER_REFUSALS = Object.freeze({
  'postgres-datasets':
    'starts its own Postgres with `docker run -p 127.0.0.1::5432`, a host port the container cannot reach; PR CI runs it',
});

/** Where things live inside the container. */
export const INSIDE = Object.freeze({ src: '/src', work: '/work', deps: '/deps' });

const usage = 'usage: node scripts/gate-container.mjs [--cpus 4] [--memory 8g] [--servers N] <gate-name ...>';

/**
 * `--cpus 4 --memory 8g --servers 2 hydration full-kit` → options. `--flag=value` works too.
 * `servers` defaults to one per two CPUs, which is CI's two servers on a four-vCPU runner.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const options = { cpus: DEFAULT_CPUS, memory: DEFAULT_MEMORY, servers: undefined, gates: [], inside: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--inside') { options.inside = true; continue; }
    const flag = /^--(cpus|memory|servers)(?:=(.*))?$/.exec(arg);
    if (flag) {
      const value = flag[2] ?? argv[++i];
      if (value === undefined || value === '') throw new Error(`--${flag[1]} needs a value\n${usage}`);
      options[flag[1]] = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg}\n${usage}`);
    options.gates.push(arg.replace(/^(?:scripts\/(?:gates\/)?)?gate-/, '').replace(/\.mjs$/, ''));
  }
  const cpus = Number(options.cpus);
  if (!(cpus > 0)) throw new Error(`--cpus must be a positive number (got ${JSON.stringify(options.cpus)})`);
  options.cpus = cpus;
  if (!/^\d+(?:\.\d+)?[bkmg]?$/i.test(String(options.memory))) throw new Error(`--memory must be a size like 8g (got ${JSON.stringify(options.memory)})`);
  const servers = options.servers === undefined ? Math.max(1, Math.floor(cpus / 2)) : Number(options.servers);
  if (!Number.isInteger(servers) || servers < 1) throw new Error(`--servers must be a whole number of at least 1 (got ${JSON.stringify(options.servers)})`);
  options.servers = servers;
  options.gates = [...new Set(options.gates)];
  if (options.gates.length === 0) throw new Error(`name at least one gate\n${usage}`);
  return options;
}

/**
 * Which requested gates exist and may run here. Throws naming every unknown gate (with the known
 * set) and every refused one (with its reason) at once.
 * @param {string[]} requested
 * @param {string[]} known  gate names discovered on disk
 */
export function checkGates(requested, known) {
  const unknown = requested.filter((name) => !known.includes(name));
  const refused = requested.filter((name) => Object.hasOwn(CONTAINER_REFUSALS, name));
  const problems = [];
  if (unknown.length) problems.push(`unknown gate(s): ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  for (const name of refused) problems.push(`${name} cannot run in a gate container: it ${CONTAINER_REFUSALS[name]}`);
  if (problems.length) throw new Error(problems.join('\n'));
}

/**
 * The gate image: the official Playwright image for the pinned Playwright (so its browsers are the
 * ones the lockfile names), with CI's Node major, bubblewrap for the real session sandbox, and the
 * native toolchain `node-pty` builds with on Linux (ubuntu-latest ships it; the image does not).
 * @param {string} playwrightVersion
 */
export function dockerfile(playwrightVersion) {
  return [
    'FROM node:22-bookworm-slim AS node',
    `FROM mcr.microsoft.com/playwright:v${playwrightVersion}-noble`,
    'COPY --from=node /usr/local/bin/node /usr/local/bin/node',
    'COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm',
    'RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \\',
    ' && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \\',
    ' && apt-get update \\',
    ' && apt-get install -y --no-install-recommends bubblewrap python3 make g++ \\',
    ' && rm -rf /var/lib/apt/lists/*',
    '',
  ].join('\n');
}

const sha = (...parts) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
};

/** The image tag: the Playwright version plus the Dockerfile's hash, so an edited Dockerfile rebuilds. */
export function imageTag(playwrightVersion) {
  return `afbin-gate:pw${playwrightVersion}-${sha(dockerfile(playwrightVersion)).slice(0, 12)}`;
}

/**
 * The dependency volume's name. It is keyed like CI's install cache — the normalised lockfile and
 * the two postinstall scripts that write into it — plus the image, whose Node and toolchain decide
 * the native binaries inside it.
 * @param {{lock: string, copyAssets: string, preparePty: string, image: string}} inputs
 */
export function depsVolume({ lock, copyAssets, preparePty, image }) {
  return `afbin-gate-deps-${sha(lock, copyAssets, preparePty, image).slice(0, 16)}`;
}

/** A container name docker accepts, unique per runner process. */
export function containerName(worktree, pid) {
  const base = String(worktree).split('/').filter(Boolean).at(-1) ?? 'tree';
  const slug = base.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40) || 'tree';
  return `afbin-gate-${slug}-${pid}`;
}

/**
 * The `docker run` argument list.
 *
 * - The worktree is mounted READ-ONLY: the container copies the source into its own `/work`, so no
 *   Linux binary, build output or install can land in the host checkout.
 * - The dependency cache is the one named volume; it outlives the container, nothing else does
 *   (`--rm`, no anonymous volumes, no published ports — its own network namespace).
 * - `--privileged` and a private cgroup namespace let the container delegate a cgroup subtree to
 *   browser sessions and run bubblewrap, as CI's runner does; the quota still binds the whole
 *   container (`cpu.max`, `memory.max`).
 * - `-i` keeps stdin open: the source list arrives on it, and its end tells the container the
 *   runner is gone, so a killed runner cannot leave a container behind.
 * - No AUTH__SECRET is passed: scripts/gates.mjs mints one per run when none is set, which is the
 *   shape of CI's per-run secret.
 */
export function dockerRunArgs({ name, image, volume, worktree, cpus, memory, servers, gates, env = {} }) {
  return [
    'run', '--rm', '-i', '--init',
    '--name', name,
    '--label', 'afbin.gate-container=1',
    '--privileged', '--cgroupns=private',
    '--cpus', String(cpus),
    '--memory', String(memory), '--memory-swap', String(memory),
    '--shm-size', '1g',
    '-v', `${worktree}:${INSIDE.src}:ro`,
    '-v', `${volume}:${INSIDE.deps}`,
    '-e', 'DATASET__ALLOW_PRIVATE_NETWORKS=true',
    '-w', INSIDE.src,
    image,
    'node', `${INSIDE.src}/scripts/gate-container.mjs`, '--inside', '--servers', String(servers), ...gates,
  ];
}
