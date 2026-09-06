import { beforeEach, expect, it, vi } from 'vitest';
import type { ClientConfig } from 'pg';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';
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
  ['warehouse.example.com', '8.8.8.8', 'DNS:warehouse.example.com', 'warehouse.example.com'],
  ['8.8.8.8', '8.8.8.8', 'IP Address:8.8.8.8', undefined],
  ['[2606:4700:4700::1111]', '2606:4700:4700::1111', 'IP Address:2606:4700:4700::1111', undefined],
])('pins the socket and verifies the configured TLS identity for %s', async (host, address, subjectaltname, servername) => {
  await discoverPostgres({ host: host!, port: 5432, database: 'fixture', username: 'fixture', password: 'fixture', ssl: true });
  expect(fixture.options?.host).toBe(address);
  const ssl = fixture.options?.ssl as ConnectionOptions;
  expect(ssl.rejectUnauthorized).toBe(true); expect(ssl.servername).toBe(servername);
  expect(typeof ssl.checkServerIdentity).toBe('function');
  expect(ssl.checkServerIdentity!('ignored-socket-host', { subject: {}, subjectaltname } as PeerCertificate)).toBeUndefined();
  expect(ssl.checkServerIdentity!('ignored-socket-host', { subject: {}, subjectaltname: 'DNS:attacker.invalid' } as PeerCertificate)).toBeInstanceOf(Error);
});
