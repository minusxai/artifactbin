import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimFreePort } from '../lib/free-port.mjs';

describe('claimFreePort', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'free-port-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('hands concurrent callers different ports even when the OS would repeat one', async () => {
    const ports = await Promise.all(Array.from({ length: 12 }, () => claimFreePort({ dir })));
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('skips a port another live run has claimed', async () => {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const taken = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    writeFileSync(path.join(dir, `artifact-gates-port-${taken}.lock`), String(process.ppid));
    const ports = await Promise.all(Array.from({ length: 20 }, () => claimFreePort({ dir })));
    expect(ports).not.toContain(taken);
  });
});
