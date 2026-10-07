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

const fixture = vi.hoisted((): { active: number; maximum: number; options?: unknown; blocked?: Promise<void>; release?: () => void; queryError?: Error } => ({ active: 0, maximum: 0 }));
vi.mock('pg', async () => (await import('@/test/helpers/pg-mock')).pgModule(fixture as PgFixture));
vi.mock('../network', () => ({
  resolvePostgresHost: vi.fn(async (host: string) => (host.startsWith('[') ? host.slice(1, -1) : host.includes(':') ? host : '8.8.8.8')),
}));
import { discoverPostgres, queryPostgres } from '../postgres';
import {resolvePostgresHost} from '../network';
import {DatasetError} from '../errors';

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
  expect(settled.find(result => result.status === 'rejected')).toMatchObject({reason:{status:503}});
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

it.each(['42703','22P02'])('returns a controlled sanitized dataset error for rejected PostgreSQL query %s',async code=>{
 fixture.queryError=Object.assign(new Error('missing column in SELECT secret FROM private_host with password=private_password'),{code});
 let failure:unknown;try{await discoverPostgres(config);}catch(error){failure=error;}
 expect(failure).toBeInstanceOf(DatasetError);expect(failure).toMatchObject({status:400});
 expect((failure as Error).message).not.toMatch(/secret|private_host|private_password|SELECT/);
 expect((failure as Error).message).toContain('column names and value types');
 expect(fixture.active).toBe(0);
});

it.each(['57014','ECONNRESET'])('returns sanitized retryable Postgres failures for %s',async code=>{
 fixture.queryError=Object.assign(new Error('sensitive driver detail password=private_password'),{code});
 await expect(discoverPostgres(config)).rejects.toMatchObject({status:503,message:expect.stringMatching(/retry/)});
 expect(fixture.active).toBe(0);
});

it('turns failed host resolution into a safe retryable dataset error before opening a socket',async()=>{
 vi.mocked(resolvePostgresHost).mockRejectedValueOnce(new Error('private_hostname private_password'));
 await expect(discoverPostgres(config)).rejects.toMatchObject({status:503,message:'Postgres connection failed. Check connection settings and retry.'});
 expect(fixture.options).toBeUndefined();expect(fixture.active).toBe(0);
});
it('returns a controlled error for invalid query bounds before allocating a connection',async()=>{
 await expect(queryPostgres(config,'select 1',[],{limit:-1})).rejects.toMatchObject({status:400,message:'Invalid Postgres query bounds'});
 expect(fixture.options).toBeUndefined();expect(fixture.active).toBe(0);
});
