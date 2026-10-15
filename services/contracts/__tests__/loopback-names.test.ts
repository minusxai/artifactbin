/**
 * The loopback names are spelled once: every Node HTTP client resolves them without a resolver
 * (utils/node/loopback-lookup), the local login-code outbox serves them, and the origin rule accepts
 * them over plain HTTP. A name that merely CONTAINS one of them is a stranger's.
 */
import { describe, expect, it } from 'vitest';
import { isLocalDevelopmentHost, isLoopbackName } from '@artifactbin/contracts';

describe('isLoopbackName', () => {
  it('names localhost, every name under it, lvh.me and every name under it', () => {
    for (const name of ['localhost', 'app.localhost', 'app.afbin.localhost', 'lvh.me', 'app.lvh.me', '6162.lvh.me', 'APP.LVH.ME']) {
      expect(isLoopbackName(name), name).toBe(true);
    }
  });
  it('refuses look-alikes, other reserved names and address literals: those are not names it may answer for', () => {
    for (const name of ['', '.localhost', '.lvh.me', 'evil-lvh.me', 'lvh.me.example.com', 'localhost.example.com', 'notlocalhost', 'app.test', '127.0.0.1', '[::1]', '::1', 'example.com']) {
      expect(isLoopbackName(name), name).toBe(false);
    }
  });
  it('is the loopback half of the local development hosts', () => {
    for (const name of ['localhost', 'app.afbin.localhost', 'lvh.me', 'app.lvh.me']) expect(isLocalDevelopmentHost(name), name).toBe(true);
    for (const name of ['127.0.0.1', '[::1]', 'app.test']) expect(isLocalDevelopmentHost(name), name).toBe(true);
    for (const name of ['evil-lvh.me', 'example.com']) expect(isLocalDevelopmentHost(name), name).toBe(false);
  });
});
