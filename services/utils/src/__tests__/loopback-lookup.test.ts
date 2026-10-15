/**
 * NODE NEVER ASKS A RESOLVER FOR A LOCAL ORIGIN. `afbin serve`, the dev server and the gates live at
 * `app.lvh.me` (public DNS: 127.0.0.1) and may live at `*.localhost` (RFC 6761); a Node client that asks
 * DNS for either waits on a network it may not have (PR #662: undici's connect timeout on `app.lvh.me`).
 * These tests stand in a resolver that fails every name, as an offline machine's does.
 */
import dns from 'node:dns';
import http from 'node:http';
import { isIP } from 'node:net';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostsFileNames, loopbackLookup, useLoopbackLookup } from '../loopback-lookup';

type Answer = { error: NodeJS.ErrnoException | null; address?: unknown; family?: number };
/** Call a lookup the way `net` does and collect what it answers. */
const ask = (lookup: typeof dns.lookup, host: string, options?: dns.LookupOptions | number): Promise<Answer> => new Promise((resolve) => {
  const done = (error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => resolve({ error, address, family });
  if (options === undefined) (lookup as (h: string, cb: typeof done) => void)(host, done);
  else (lookup as (h: string, o: unknown, cb: typeof done) => void)(host, options, done);
});

/** An offline machine's resolver: address literals answer themselves (as getaddrinfo's do), every name fails. */
const offline = (() => {
  const asked: string[] = [];
  const real = dns.lookup;
  const lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    if (isIP(hostname)) return (real as (...args: unknown[]) => void).call(dns, hostname, options, callback);
    const cb = (typeof options === 'function' ? options : callback) as (error: NodeJS.ErrnoException) => void;
    asked.push(hostname);
    const error = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname }) as NodeJS.ErrnoException;
    process.nextTick(cb, error);
  }) as unknown as typeof dns.lookup;
  return { asked, lookup };
})();

describe('loopbackLookup', () => {
  const lookup = loopbackLookup(offline.lookup, () => false);
  beforeEach(() => { offline.asked.length = 0; });

  it('answers a loopback name with IPv4 loopback, in every calling shape net and http use, without asking the resolver', async () => {
    expect(await ask(lookup, 'app.lvh.me')).toEqual({ error: null, address: '127.0.0.1', family: 4 });
    expect(await ask(lookup, 'APP.AFBIN.LOCALHOST', {})).toEqual({ error: null, address: '127.0.0.1', family: 4 });
    expect(await ask(lookup, 'localhost', 4)).toEqual({ error: null, address: '127.0.0.1', family: 4 });
    expect(await ask(lookup, 'lvh.me', 6)).toEqual({ error: null, address: '::1', family: 6 });
    expect(await ask(lookup, 'lvh.me', { family: 'IPv6' })).toEqual({ error: null, address: '::1', family: 6 });
    expect(await ask(lookup, '6162.lvh.me', { all: true })).toEqual({ error: null, address: [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }], family: undefined });
    expect(await ask(lookup, 'app.localhost', { all: true, family: 4 })).toEqual({ error: null, address: [{ address: '127.0.0.1', family: 4 }], family: undefined });
    expect(offline.asked).toEqual([]);
  });

  it('hands every other name to the resolver it wraps, unchanged', async () => {
    for (const host of ['example.com', 'evil-lvh.me', 'lvh.me.example.com', 'app.test']) {
      const answer = await ask(lookup, host, { all: true });
      expect(answer.error?.code, host).toBe('ENOTFOUND');
    }
    expect(offline.asked).toEqual(['example.com', 'evil-lvh.me', 'lvh.me.example.com', 'app.test']);
  });

  it('answers asynchronously, as dns.lookup does', () => {
    let answered = false;
    (lookup as (h: string, cb: () => void) => void)('app.lvh.me', () => { answered = true; });
    expect(answered).toBe(false);
  });
});

describe('useLoopbackLookup', () => {
  const original = dns.lookup;
  let server: RunningServer;
  let port = 0;
  beforeEach(async () => {
    dns.lookup = offline.lookup;
    offline.asked.length = 0;
    server = await withHttpServer((request, response) => response.end(`hello ${request.headers.host}`));
    port = server.port;
  });
  afterEach(async () => {
    dns.lookup = original;
    await server.close();
  });

  it('without it, an offline resolver leaves fetch unable to reach app.lvh.me', async () => {
    await expect(fetch(`http://app.lvh.me:${port}/`)).rejects.toThrow();
    expect(offline.asked).toContain('app.lvh.me');
  });

  it('with it, fetch and http.get reach a local origin on loopback, and other names still go to the resolver', async () => {
    useLoopbackLookup();
    const response = await fetch(`http://app.lvh.me:${port}/`);
    expect(await response.text()).toBe(`hello app.lvh.me:${port}`);
    expect(await (await fetch(`http://6162.afbin.localhost:${port}/`)).text()).toBe(`hello 6162.afbin.localhost:${port}`);
    const viaHttp = await new Promise<string>((resolve, reject) => {
      http.get(`http://lvh.me:${port}/`, (answer) => { let body = ''; answer.on('data', (chunk) => { body += chunk; }); answer.on('end', () => resolve(body)); }).on('error', reject);
    });
    expect(viaHttp).toBe(`hello lvh.me:${port}`);
    await expect(fetch(`http://elsewhere.example:${port}/`)).rejects.toThrow();
    expect(offline.asked).toEqual(['elsewhere.example']);
  });

  it('installs once: a second call does not wrap the first', async () => {
    useLoopbackLookup();
    const installed = dns.lookup;
    useLoopbackLookup();
    expect(dns.lookup).toBe(installed);
  });
});

describe('a loopback name the hosts file maps', () => {
  it('goes to the resolver, which answers from the hosts file (a container routing app.lvh.me to its host)', async () => {
    const asked: string[] = [];
    const hostGateway = ((hostname: string, options: unknown, callback?: unknown) => {
      asked.push(hostname);
      const cb = (typeof options === 'function' ? options : callback) as (e: null, a: string, f: number) => void;
      process.nextTick(cb, null, '172.17.0.1', 4);
    }) as unknown as typeof dns.lookup;
    const lookup = loopbackLookup(hostGateway, (name) => name === 'app.lvh.me');
    expect(await ask(lookup, 'app.lvh.me')).toEqual({ error: null, address: '172.17.0.1', family: 4 });
    expect(asked).toEqual(['app.lvh.me']);
    // Other loopback names the file does not list still answer loopback without asking.
    expect(await ask(lookup, 'abc123.lvh.me')).toEqual({ error: null, address: '127.0.0.1', family: 4 });
    expect(asked).toEqual(['app.lvh.me']);
  });

  it('reads the names a hosts file lists, ignoring comments, addresses and case, and none from a missing file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-')), 'hosts');
    fs.writeFileSync(file, '# comment app.lvh.me\n127.0.0.1\tlocalhost\n172.17.0.1 App.LVH.me other.test # trailing\n\n');
    expect([...hostsFileNames(file)].sort()).toEqual(['app.lvh.me', 'localhost', 'other.test']);
    expect(hostsFileNames(path.join(file, 'missing')).size).toBe(0);
  });
});
