/**
 * A PORT THIS MACHINE'S GATE RUNS CLAIM BETWEEN THEM.
 *
 * Asking the OS for port 0 and closing the probe leaves a window before the server binds, and two runners starting
 * in the same moment (the CLI-distribution job starts three) were handed the same port: the second server died with
 * "already in use" while its runner, seeing the first one answer, drove the OTHER run's server and read the wrong
 * outbox. A claim is an exclusive lock file named for the port, held until the claiming process exits; a claim whose
 * process is gone is taken over.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const held = new Set();
process.on('exit', () => { for (const file of held) { try { rmSync(file, { force: true }); } catch { /* best effort */ } } });

const askOs = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };

function claim(file) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { writeFileSync(file, String(process.pid), { flag: 'wx' }); held.add(file); return true; }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const holder = Number(readFileSync(file, 'utf8'));
      if (alive(holder)) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}

/** A port nothing holds right now and no other run on this machine has claimed. */
export async function claimFreePort({ dir = os.tmpdir() } = {}) {
  for (;;) {
    const port = await askOs();
    if (claim(path.join(dir, `artifact-gates-port-${port}.lock`))) return port;
  }
}
