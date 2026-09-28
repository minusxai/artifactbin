/**
 * THE GATE-SLOT SEMAPHORE — how many browser-gate containers run at once on this machine.
 *
 * Gates flake under CPU contention (timing budgets, exports failing under load), which is why one
 * agent at a time used to hold a single `mkdir /tmp/afbin-gate-lock`. scripts/gate-container.mjs runs
 * each gate set in a Linux container with a fixed CPU and memory quota instead, so the container
 * engine can hold several side by side — as many as its CPUs and memory fit (`slotCount`). Each
 * running container holds one SLOT: a directory `<dir>/<n>`, n in 1..slots. `mkdir` is atomic, so
 * exactly one runner wins a slot, on any filesystem and from any worktree.
 *
 * A slot records its owner (`owner.json`: a random token, the pid, the host). A slot whose owner
 * process is gone — a runner that was SIGKILLed never releases — is RECLAIMED rather than held for
 * ever; so is a bare directory older than `graceMs` (a runner that died between `mkdir` and writing
 * its record). Reclaiming is serialised by a short `<dir>/.reclaim` lock so two waiters cannot both
 * remove a slot and one of them free a slot someone else just took. `release()` removes the slot only
 * while it still carries the releaser's token: an owner that was declared dead and comes back late
 * cannot free its successor's slot.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Where the container runner keeps its slots — beside the old single lock, visible to every worktree. */
export const DEFAULT_SLOTS_DIR = '/tmp/afbin-gate-slots';

const OWNER = 'owner.json';
const RECLAIM = '.reclaim';
/** A reclaim takes milliseconds; a reclaim lock older than this belongs to a reclaimer that died. */
const RECLAIM_STALE_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a pid on THIS host is a live process. EPERM means it exists but is someone else's. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** Docker-style size (`8g`, `512m`, `1024k`, bytes) → bytes. */
export function parseMemory(value) {
  const match = /^(\d+(?:\.\d+)?)([bkmg]?)$/i.exec(String(value).trim());
  if (!match) throw new Error(`bad memory size ${JSON.stringify(value)} (expected e.g. 8g or 512m)`);
  const scale = { '': 1, b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase()];
  return Math.floor(Number(match[1]) * scale);
}

/**
 * How many gate containers fit at once. `GATES__CONTAINER_SLOTS` (passed as `setting`) wins; otherwise
 * the engine's CPUs ÷ the container's CPUs and its memory ÷ the container's memory, whichever is
 * smaller, and never fewer than one — a small engine runs gate sets one after another, not never.
 */
export function slotCount({ engineCpus, engineMemory, cpus, memory, setting }) {
  if (setting !== undefined && setting !== '') {
    const n = Number(setting);
    if (!Number.isInteger(n) || n < 1) throw new Error(`GATES__CONTAINER_SLOTS must be a whole number of at least 1 (got ${JSON.stringify(setting)})`);
    return n;
  }
  const byCpu = engineCpus > 0 && cpus > 0 ? Math.floor(engineCpus / cpus) : 1;
  const byMemory = engineMemory > 0 && memory > 0 ? Math.floor(engineMemory / memory) : 1;
  return Math.max(1, Math.min(byCpu, byMemory));
}

async function readOwner(slotDir) {
  try {
    return JSON.parse(await readFile(path.join(slotDir, OWNER), 'utf8'));
  } catch {
    return null;
  }
}

async function ageMs(target) {
  try {
    return Date.now() - (await stat(target)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Whether a held slot's owner is gone for good. A slot owned on another host is never judged here. */
async function isStale(slotDir, { isAlive, graceMs }) {
  const owner = await readOwner(slotDir);
  if (!owner) return (await ageMs(slotDir)) >= graceMs;
  if (owner.host !== os.hostname()) return false;
  return !isAlive(owner.pid);
}

/** Remove a dead owner's slot under the reclaim lock; false when the lock is busy or the owner revived. */
async function reclaim(dir, slotDir, options) {
  const lock = path.join(dir, RECLAIM);
  try {
    await mkdir(lock);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    if ((await ageMs(lock)) < RECLAIM_STALE_MS) return false;
    await rm(lock, { recursive: true, force: true });
    return false;
  }
  try {
    // Re-judged under the lock: only an owner release or another reclaimer removes a slot, the
    // first is impossible for a dead owner and the second is excluded by the lock.
    if (!(await isStale(slotDir, options))) return false;
    await rm(slotDir, { recursive: true, force: true });
    return true;
  } finally {
    await rmdir(lock).catch(() => {});
  }
}

const describeHolders = async (dir, slots) => {
  const lines = [];
  for (let n = 1; n <= slots; n++) {
    const owner = await readOwner(path.join(dir, String(n)));
    if (owner) lines.push(`${n}: pid ${owner.pid}${owner.worktree ? ` ${owner.worktree}` : ''}${owner.gates ? ` [${owner.gates}]` : ''} since ${owner.since}`);
  }
  return lines;
};

/**
 * Take a free slot, waiting (polling every `pollMs`) while all `slots` are held.
 *
 * @param {object} options
 * @param {string} [options.dir]        the slot directory (created if missing)
 * @param {number} options.slots        how many slots exist (a whole number ≥ 1)
 * @param {object} [options.owner]      extra facts recorded with the slot (worktree, gates) and shown to waiters
 * @param {number} [options.pollMs]     how often a waiting runner looks again
 * @param {number} [options.timeoutMs]  give up after this long (default: never)
 * @param {number} [options.graceMs]    how long a slot with no owner record counts as being taken
 * @param {(pid: number) => boolean} [options.isAlive]  whether a local pid is alive
 * @param {(holders: string[]) => void} [options.onWait]  called once, when the runner first has to wait
 * @returns {Promise<{index: number, path: string, release: () => Promise<void>}>}
 */
export async function acquireSlot({
  dir = DEFAULT_SLOTS_DIR,
  slots,
  owner = {},
  pollMs = 5000,
  timeoutMs = Infinity,
  graceMs = 60_000,
  isAlive = pidAlive,
  onWait,
} = {}) {
  if (!Number.isInteger(slots) || slots < 1) throw new Error(`slots must be a whole number of at least 1 (got ${slots})`);
  await mkdir(dir, { recursive: true });
  const token = randomBytes(12).toString('hex');
  const record = { ...owner, token, pid: process.pid, host: os.hostname(), since: new Date().toISOString() };
  const deadline = Date.now() + timeoutMs;
  let waited = false;

  for (;;) {
    for (let n = 1; n <= slots; n++) {
      const slotDir = path.join(dir, String(n));
      try {
        await mkdir(slotDir);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (!(await isStale(slotDir, { isAlive, graceMs }))) continue;
        if (!(await reclaim(dir, slotDir, { isAlive, graceMs }))) continue;
        try {
          await mkdir(slotDir);
        } catch (again) {
          if (again?.code === 'EEXIST') continue;
          throw again;
        }
      }
      await writeFile(path.join(slotDir, OWNER), JSON.stringify(record));
      let released = false;
      return {
        index: n,
        path: slotDir,
        async release() {
          if (released) return;
          released = true;
          const current = await readOwner(slotDir);
          if (current?.token !== token) return;
          await rm(slotDir, { recursive: true, force: true });
        },
      };
    }
    if (Date.now() >= deadline) {
      const holders = await describeHolders(dir, slots);
      throw new Error(`no gate slot free after ${Math.round(timeoutMs / 1000)}s: ${slots} of ${slots} held\n  ${holders.join('\n  ')}`);
    }
    if (!waited) {
      waited = true;
      onWait?.(await describeHolders(dir, slots));
    }
    await sleep(Math.max(1, Math.min(pollMs, deadline - Date.now())));
  }
}
