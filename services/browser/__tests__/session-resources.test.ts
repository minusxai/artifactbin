import { expect, it, vi } from 'vitest';
import { createSessionResources } from '../src/session-resources';

it('sets hard resource limits before admitting a worker and kills the entire group on close', async () => {
  const writes: Array<[string, string]> = [];
  const io = { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async (file: string, value: string) => { writes.push([file,value]); }), rmdir: vi.fn(async () => {}) };
  const resource = await createSessionResources('/delegated', io);
  expect(writes.map(([file,value]) => [file.split('/').at(-1),value])).toEqual([
    ['memory.max','1073741824'], ['memory.swap.max','0'], ['pids.max','512'], ['cpu.max','100000 100000'],
  ]);
  await resource.attach(123);
  expect(writes.at(-1)).toEqual([`${resource.path}/cgroup.procs`,'123']);
  await resource.close(); await resource.close();
  expect(writes.filter(([file]) => file.endsWith('/cgroup.kill'))).toHaveLength(1);
});
