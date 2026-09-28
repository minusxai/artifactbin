/**
 * THE GATE-SLOT SEMAPHORE, on a real filesystem.
 *
 * Browser gates run in containers with fixed CPU and memory quotas
 * (scripts/gate-container.mjs), and the machine fits a known number of them.
 * The slots are directories — `mkdir` is atomic, so exactly one runner wins a
 * slot — and a slot whose owner has died is reclaimed rather than held for ever.
 * Every case below uses real `mkdir`s in a temporary directory; nothing is mocked
 * except, where named, whether a pid is alive.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireSlot, parseMemory, slotCount } from '../lib/gate-slots.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/gate-slots.mjs');
let dir;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'gate-slots-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const held = () => readdirSync(dir).filter((name) => /^\d+$/.test(name)).sort();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('acquireSlot', () => {
  it('fills every slot with a distinct index, and the next runner waits until one is released', async () => {
    const a = await acquireSlot({ dir, slots: 2, pollMs: 10 });
    const b = await acquireSlot({ dir, slots: 2, pollMs: 10 });
    expect(new Set([a.index, b.index])).toEqual(new Set([1, 2]));
    expect(held()).toEqual(['1', '2']);

    let third;
    const waiting = acquireSlot({ dir, slots: 2, pollMs: 10 }).then((slot) => { third = slot; return slot; });
    await sleep(80);
    expect(third, 'a full semaphore must make the third runner wait').toBeUndefined();

    await b.release();
    const got = await waiting;
    expect(got.index).toBe(b.index);
    await a.release();
    await got.release();
    expect(held()).toEqual([]);
  });

  it('never lets two concurrent holders share a slot, and never holds more than the slot count', async () => {
    const slots = 3;
    const inUse = new Set();
    let peak = 0;
    const worker = async () => {
      const slot = await acquireSlot({ dir, slots, pollMs: 5 });
      expect(inUse.has(slot.index), `slot ${slot.index} handed out twice`).toBe(false);
      inUse.add(slot.index);
      peak = Math.max(peak, inUse.size);
      await sleep(15);
      inUse.delete(slot.index);
      await slot.release();
    };
    await Promise.all(Array.from({ length: 12 }, worker));
    expect(peak).toBe(slots);
    expect(held()).toEqual([]);
  });

  it('reclaims a slot whose owning process was killed', async () => {
    // A real child process takes slot 1 and is SIGKILLed — it gets no chance to release.
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { acquireSlot } from ${JSON.stringify(LIB)};
      const slot = await acquireSlot({ dir: ${JSON.stringify(dir)}, slots: 1, pollMs: 10 });
      console.log('held ' + slot.index);
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve) => child.stdout.on('data', (b) => { if (String(b).includes('held 1')) resolve(); }));
    expect(held()).toEqual(['1']);
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('exit', resolve));

    const slot = await acquireSlot({ dir, slots: 1, pollMs: 10, timeoutMs: 2000 });
    expect(slot.index).toBe(1);
    await slot.release();
  });

  it('does not reclaim a slot whose owner is alive, and says who holds it when it gives up', async () => {
    const holder = await acquireSlot({ dir, slots: 1, pollMs: 10, owner: { worktree: '/tmp/some-tree' } });
    await expect(acquireSlot({ dir, slots: 1, pollMs: 10, timeoutMs: 100 }))
      .rejects.toThrow(/no gate slot free.*1 of 1.*some-tree/s);
    expect(held()).toEqual(['1']);
    await holder.release();
  });

  it('treats a slot with no owner record as held while it is young, and reclaims it once it is stale', async () => {
    // A runner that crashed between mkdir and writing its record leaves a bare directory.
    mkdirSync(path.join(dir, '1'));
    await expect(acquireSlot({ dir, slots: 1, pollMs: 10, timeoutMs: 100, graceMs: 60_000 })).rejects.toThrow(/no gate slot free/);
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(path.join(dir, '1'), old, old);
    const slot = await acquireSlot({ dir, slots: 1, pollMs: 10, timeoutMs: 1000, graceMs: 60_000 });
    expect(slot.index).toBe(1);
    await slot.release();
  });

  it('a released-late owner does not free a slot that was reclaimed and handed to someone else', async () => {
    const first = await acquireSlot({ dir, slots: 1, pollMs: 10, isAlive: () => true });
    // The first owner is declared dead (a pid the checker says is gone) and its slot is taken over.
    const second = await acquireSlot({ dir, slots: 1, pollMs: 10, timeoutMs: 1000, isAlive: () => false });
    expect(second.index).toBe(1);
    await first.release();
    expect(held(), 'the stale release must leave the new owner holding slot 1').toEqual(['1']);
    await second.release();
    expect(held()).toEqual([]);
  });

  it('refuses a slot count that is not a positive whole number', async () => {
    await expect(acquireSlot({ dir, slots: 0 })).rejects.toThrow(/slots/);
    await expect(acquireSlot({ dir, slots: 1.5 })).rejects.toThrow(/slots/);
  });

  it('creates the slot directory when it does not exist yet', async () => {
    const nested = path.join(dir, 'not', 'there');
    const slot = await acquireSlot({ dir: nested, slots: 1 });
    expect(existsSync(path.join(nested, '1'))).toBe(true);
    await slot.release();
    expect(existsSync(path.join(nested, '1'))).toBe(false);
  });

  it('keeps unrelated files in the slot directory out of the count', async () => {
    writeFileSync(path.join(dir, 'README'), 'not a slot');
    const slot = await acquireSlot({ dir, slots: 1, pollMs: 10, timeoutMs: 200 });
    expect(slot.index).toBe(1);
    await slot.release();
  });
});

describe('slotCount', () => {
  const GiB = 1024 ** 3;

  it('fits as many containers as both the CPUs and the memory allow', () => {
    // Colima here: 14 CPUs, ~35 GiB usable; a container asks for 4 CPUs and 8 GiB.
    expect(slotCount({ engineCpus: 14, engineMemory: 35 * GiB, cpus: 4, memory: 8 * GiB })).toBe(3);
    expect(slotCount({ engineCpus: 32, engineMemory: 16 * GiB, cpus: 4, memory: 8 * GiB })).toBe(2);
    expect(slotCount({ engineCpus: 8, engineMemory: 64 * GiB, cpus: 2, memory: 4 * GiB })).toBe(4);
  });

  it('never goes below one, so a small engine runs gates serially rather than never', () => {
    expect(slotCount({ engineCpus: 2, engineMemory: 4 * GiB, cpus: 4, memory: 8 * GiB })).toBe(1);
    expect(slotCount({ engineCpus: undefined, engineMemory: undefined, cpus: 4, memory: 8 * GiB })).toBe(1);
  });

  it('an explicit setting wins, and a malformed one is refused', () => {
    expect(slotCount({ engineCpus: 14, engineMemory: 35 * GiB, cpus: 4, memory: 8 * GiB, setting: '5' })).toBe(5);
    expect(() => slotCount({ engineCpus: 14, engineMemory: 35 * GiB, cpus: 4, memory: 8 * GiB, setting: 'lots' })).toThrow(/GATES__CONTAINER_SLOTS/);
    expect(() => slotCount({ engineCpus: 14, engineMemory: 35 * GiB, cpus: 4, memory: 8 * GiB, setting: '0' })).toThrow(/GATES__CONTAINER_SLOTS/);
  });
});

describe('parseMemory', () => {
  it('reads docker-style sizes', () => {
    expect(parseMemory('8g')).toBe(8 * 1024 ** 3);
    expect(parseMemory('512m')).toBe(512 * 1024 ** 2);
    expect(parseMemory('6G')).toBe(6 * 1024 ** 3);
    expect(() => parseMemory('eight')).toThrow(/memory/);
  });
});
