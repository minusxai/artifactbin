/**
 * A dataset's PostgreSQL host is resolved by its own resolver (node:dns/promises, or the configured nameservers),
 * independent of the loopback lookup the app server installs for its own origins (utils/node/loopback-lookup), and
 * judged on the address. A loopback NAME is refused like 127.0.0.1 — whether this machine's resolver answers it
 * with loopback or cannot answer it at all — on a server that has the loopback lookup installed, as server.ts does.
 * (network.test.ts mocks the resolver; this file runs the real one.)
 */
import { describe, expect, it } from 'vitest';
import { useLoopbackLookup } from '@artifactbin/utils/node/loopback-lookup';
import { resolvePostgresHost } from '../network';

describe('PostgreSQL hosts named under localhost or lvh.me', () => {
  it('are refused, never resolved to this server', async () => {
    useLoopbackLookup();
    for (const host of ['anything.localhost', 'db.afbin.localhost', 'x.lvh.me', 'localhost']) {
      await expect(resolvePostgresHost(host), host).rejects.toThrow(/not permitted|could not be resolved|timed out/);
    }
  });
});
