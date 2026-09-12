/**
 * The Postgres driver as the app constructs it, with no database anywhere: what TLS identity it
 * pins, and how many connections it will hold at once. Two files with the same hand-rolled
 * `vi.mock('pg', …)` — one recording construction options, the other counting connections — are
 * one file over one fake client (`test/helpers/pg-mock`), because they mock the same module and
 * a test needing both halves would otherwise have written a third copy.
 */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientConfig } from 'pg';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';
import { resetPgFixture, type PgFixture } from '@/test/helpers/pg-mock';

// Public certificates only: TLS presents a raw DER certificate in production.
const matchingCertificate = new X509Certificate(readFileSync(new URL('./fixtures/postgres-tls.pem', import.meta.url))).toLegacyObject();
const wrongCertificate = new X509Certificate(readFileSync(new URL('./fixtures/postgres-tls-wrong.pem', import.meta.url))).toLegacyObject();

const fixture = vi.hoisted((): { active: number; maximum: number; options?: unknown; blocked?: Promise<void>; release?: () => void } => ({ active: 0, maximum: 0 }));
vi.mock('pg', async () => (await import('@/test/helpers/pg-mock')).pgModule(fixture as PgFixture));
vi.mock('../network', () => ({
  resolvePostgresHost: vi.fn(async (host: string) => (host.startsWith('[') ? host.slice(1, -1) : host.includes(':') ? host : '8.8.8.8')),
}));
import { discoverPostgres } from '../postgres';

const config = { host: 'fixture', port: 5432, database: 'fixture', username: 'fixture', password: 'secret', ssl: false };
const options = () => fixture.options as ClientConfig | undefined;

beforeEach(() => resetPgFixture(fixture as PgFixture));
afterEach(() => { resetPgFixture(fixture as PgFixture); vi.useRealTimers(); });

it.each([
  ['warehouse.example.com', '8.8.8.8', 'warehouse.example.com'],
  ['8.8.8.8', '8.8.8.8', undefined],
  ['[2606:4700:4700::1111]', '2606:4700:4700::1111', undefined],
])('pins the socket and verifies the configured TLS identity for %s', async (host, address, servername) => {
  await discoverPostgres({ host: host!, port: 5432, database: 'fixture', username: 'fixture', password: 'fixture', ssl: true });
  expect(options()?.host).toBe(address);
  const ssl = options()?.ssl as ConnectionOptions;
  expect(ssl.rejectUnauthorized).toBe(true); expect(ssl.servername).toBe(servername);
  expect(typeof ssl.checkServerIdentity).toBe('function');
  expect(ssl.checkServerIdentity!('ignored-socket-host', matchingCertificate as PeerCertificate)).toBeUndefined();
  expect(ssl.checkServerIdentity!('ignored-socket-host', wrongCertificate as PeerCertificate)).toBeInstanceOf(Error);
});

it('fails closed when an IP peer has no usable raw certificate', async () => {
  await discoverPostgres({ host: '8.8.8.8', port: 5432, database: 'fixture', username: 'fixture', password: 'fixture', ssl: true });
  const ssl = options()?.ssl as ConnectionOptions;
  for (const raw of [undefined, Buffer.from('not a certificate')]) {
    const peer = { ...matchingCertificate, raw } as PeerCertificate;
    expect(ssl.checkServerIdentity!('ignored-socket-host', peer)).toBeInstanceOf(Error);
  }
});

it('limits connections to eight and rejects requests beyond its bounded queue', async () => {
  fixture.blocked = new Promise((resolve) => { fixture.release = resolve; });
  const requests = Array.from({ length: 41 }, () => discoverPostgres(config));
  const results = Promise.allSettled(requests);
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.maximum).toBe(8);
  } finally { fixture.release!(); await results; }
  const settled = await results;
  expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(40);
  expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(fixture.maximum).toBe(8); expect(fixture.active).toBe(0);
});

it('expires queued work and removes it before a slot becomes free', async () => {
  vi.useFakeTimers();
  fixture.blocked = new Promise((resolve) => { fixture.release = resolve; });
  const holders = Array.from({ length: 8 }, () => discoverPostgres(config));
  const queued = discoverPostgres(config);
  const observed = queued.then(() => 'accepted', (error) => error.message);
  const completed = Promise.allSettled(holders);
  try {
    await vi.advanceTimersByTimeAsync(1001);
    expect(await observed).toMatch(/queue timed out/);
  } finally { fixture.release!(); await completed; }
  expect((await completed).every((result) => result.status === 'fulfilled')).toBe(true);
  expect(fixture.active).toBe(0); expect(fixture.maximum).toBe(8);
});
