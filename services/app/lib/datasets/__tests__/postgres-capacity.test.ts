import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ active: 0, maximum: 0, release: undefined as undefined | (() => void), blocked: undefined as undefined | Promise<void> }));
vi.mock('pg', () => ({ default: {
  types: { getTypeParser: () => (value: unknown) => value },
  Client: class {
    on() {}
    async connect() { fixture.active++; fixture.maximum = Math.max(fixture.maximum, fixture.active); await fixture.blocked; }
    async query() { return { rows: [], fields: [] }; }
    async end() { fixture.active--; }
  },
} }));
import { discoverPostgres } from '../postgres';
const config = { host: 'fixture', port: 5432, database: 'fixture', username: 'fixture', password: 'secret', ssl: false };
afterEach(() => { fixture.release?.(); fixture.active = 0; fixture.maximum = 0; fixture.blocked = undefined; vi.useRealTimers(); });
it('limits connections to eight and rejects requests beyond its bounded queue', async () => {
  fixture.blocked = new Promise(resolve => { fixture.release = resolve; });
  const requests = Array.from({ length: 41 }, () => discoverPostgres(config));
  const results = Promise.allSettled(requests);
  await Promise.resolve();
  expect(fixture.maximum).toBe(8);
  fixture.release!();
  const settled = await results;
  expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(40);
  expect(settled.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(fixture.maximum).toBe(8); expect(fixture.active).toBe(0);
});
it('expires queued work and removes it before a slot becomes free', async () => {
  vi.useFakeTimers();
  fixture.blocked = new Promise(resolve => { fixture.release = resolve; });
  const holders = Array.from({ length: 8 }, () => discoverPostgres(config));
  const queued = discoverPostgres(config);
  const expectation = expect(queued).rejects.toThrow(/queue timed out/);
  await vi.advanceTimersByTimeAsync(1001);
  fixture.release!();
  await expectation; await Promise.all(holders);
  expect(fixture.active).toBe(0); expect(fixture.maximum).toBe(8);
});
