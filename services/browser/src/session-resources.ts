import { mkdir, writeFile, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

interface ResourceIO { mkdir(path: string): Promise<unknown>; writeFile(path: string, value: string): Promise<unknown>; rmdir(path: string): Promise<unknown> }
/** A delegated cgroup v2 subtree is required; namespaces alone do not bound resources. */
export async function createSessionResources(root: string, io: ResourceIO = { mkdir, writeFile, rmdir }) {
  const group = path.join(root, randomUUID());
  await io.mkdir(group);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await io.writeFile(path.join(group, 'cgroup.kill'), '1');
    for (let attempt = 0; ; attempt++) {
      try { await io.rmdir(group); return; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt >= 49) throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  };
  try {
    for (const [name, value] of [['memory.max', '1073741824'], ['memory.swap.max', '0'], ['pids.max', '512'], ['cpu.max', '100000 100000']] as const) await io.writeFile(path.join(group, name), value);
    return { path: group, async attach(pid: number) { await io.writeFile(path.join(group, 'cgroup.procs'), String(pid)); }, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
