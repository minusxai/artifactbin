import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ClientConfig } from 'pg';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';
// Public certificates only: TLS presents a raw DER certificate in production.
const matchingCertificate = new X509Certificate(readFileSync(new URL('./fixtures/postgres-tls.pem', import.meta.url))).toLegacyObject();
const wrongCertificate = new X509Certificate(readFileSync(new URL('./fixtures/postgres-tls-wrong.pem', import.meta.url))).toLegacyObject();
const fixture = vi.hoisted(() => ({ options: undefined as ClientConfig | undefined }));
vi.mock('../network', () => ({ resolvePostgresHost: vi.fn(async (host: string) => host.startsWith('[') ? host.slice(1, -1) : host.includes(':') ? host : '8.8.8.8') }));
vi.mock('pg', () => ({ default: {
  types: { getTypeParser: () => (value: unknown) => value },
  Client: class {
    constructor(options: ClientConfig) { fixture.options = options; }
    on() {}
    async connect() {}
    async query() { return { rows: [], fields: [] }; }
    async end() {}
  },
} }));
import { discoverPostgres } from '../postgres';
beforeEach(() => { fixture.options = undefined; });
it.each([
  ['warehouse.example.com', '8.8.8.8', 'warehouse.example.com'],
  ['8.8.8.8', '8.8.8.8', undefined],
  ['[2606:4700:4700::1111]', '2606:4700:4700::1111', undefined],
])('pins the socket and verifies the configured TLS identity for %s', async (host, address, servername) => {
  await discoverPostgres({ host: host!, port: 5432, database: 'fixture', username: 'fixture', password: 'fixture', ssl: true });
  expect(fixture.options?.host).toBe(address);
  const ssl = fixture.options?.ssl as ConnectionOptions;
  expect(ssl.rejectUnauthorized).toBe(true); expect(ssl.servername).toBe(servername);
  expect(typeof ssl.checkServerIdentity).toBe('function');
  expect(ssl.checkServerIdentity!('ignored-socket-host', matchingCertificate as PeerCertificate)).toBeUndefined();
  expect(ssl.checkServerIdentity!('ignored-socket-host', wrongCertificate as PeerCertificate)).toBeInstanceOf(Error);
});
it('fails closed when an IP peer has no usable raw certificate', async () => {
  await discoverPostgres({ host: '8.8.8.8', port: 5432, database: 'fixture', username: 'fixture', password: 'fixture', ssl: true });
  const ssl = fixture.options?.ssl as ConnectionOptions;
  for (const raw of [undefined, Buffer.from('not a certificate')]) {
    const peer = { ...matchingCertificate, raw } as PeerCertificate;
    expect(ssl.checkServerIdentity!('ignored-socket-host', peer)).toBeInstanceOf(Error);
  }
});
