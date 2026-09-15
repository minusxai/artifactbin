import { expect, it } from 'vitest';
import { runGateQueue } from '../gates.queue.mjs';

it('runs ordinary gates concurrently and exclusive gates alone after they finish', async () => {
  const gates = [{ name: 'a' }, { name: 'heavy', exclusive: true }, { name: 'b' }, { name: 'heavy2', exclusive: true }];
  const active = new Set();
  const overlaps = [];
  const completed = [];
  let ordinaryPeak = 0;
  await runGateQueue(gates, ['one', 'two'], async (gate, base) => {
    if (gate.exclusive && active.size) overlaps.push(gate.name);
    if (!gate.exclusive && [...active].some(name => name.startsWith('heavy'))) overlaps.push(gate.name);
    active.add(gate.name);
    if (!gate.exclusive) ordinaryPeak = Math.max(ordinaryPeak, active.size);
    await new Promise(resolve => setTimeout(resolve, 5));
    active.delete(gate.name);
    completed.push({ name: gate.name, base });
  });
  expect(overlaps).toEqual([]);
  expect(ordinaryPeak).toBe(2);
  expect(completed.map(result => result.name).sort()).toEqual(gates.map(gate => gate.name).sort());
  expect(completed.slice(-2)).toEqual([{ name: 'heavy', base: 'one' }, { name: 'heavy2', base: 'one' }]);
});

it('runs an exclusively selected gate exactly once with a single server', async () => {
  const calls = [];
  await runGateQueue([{ name: 'heavy', exclusive: true }], ['one'], async (gate, base) => calls.push([gate.name, base]));
  expect(calls).toEqual([['heavy', 'one']]);
});
