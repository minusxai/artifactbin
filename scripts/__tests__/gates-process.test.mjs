import { expect, it } from 'vitest';
import { runGateProcess } from '../gates.process.mjs';

it('waits for timed-out gate cleanup before releasing its worker', async () => {
  const result = await runGateProcess(process.execPath, ['-e', `
    process.on('SIGTERM', () => {
      setTimeout(() => { console.log('cleanup complete'); process.exit(0); }, 100);
    });
    console.log('started');
    setInterval(() => {}, 1000);
  `], { timeoutMs: 200 });
  expect(result.ok).toBe(false);
  expect(result.output).toContain('started');
  expect(result.output).toContain('cleanup complete');
  expect(result.seconds).toBeGreaterThanOrEqual(0.28);
});

it('preserves a successful gate verdict and its output', async () => {
  const result = await runGateProcess(process.execPath, ['-e', "console.log('passed')"], { timeoutMs: 1000 });
  expect(result.ok).toBe(true);
  expect(result.output).toContain('passed');
});
